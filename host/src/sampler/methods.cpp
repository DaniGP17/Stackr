#include "methods.h"

#include <windows.h>
#include <commdlg.h>

#include <fstream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <unordered_set>

#include "sampler.h"

#include "../ipc/rpc_router.h"
#include "../symbols/methods.h"
#include "../symbols/resolver.h"
#include "../util/json.h"

#pragma comment(lib, "Comdlg32.lib")

namespace stackr::sampler {

// ─── .stackr file format ──────────────────────────────────────────────────────
// Header (32 bytes):
//   magic        uint64   0x52545153544B5200ULL  ("STACKR\0\0" LE)
//   version      uint32   2
//   pid          uint32
//   elapsed_ms   uint64
//   count        uint64   (number of samples)
// Per sample (variable):
//   timestamp_ns uint64
//   tid          uint32
//   depth        uint16
//   truncated    uint16
//   frames       uint64[depth]
// Symbol table (v2+, after all samples):
//   sym_count    uint64
//   per symbol:
//     addr         uint64
//     fn_len       uint32
//     mod_len      uint32
//     src_len      uint32
//     fn_name      char[fn_len]
//     mod_name     char[mod_len]
//     src_file     char[src_len]
//     module_base  uint64
//     displacement uint32
//     source_line  uint32
// CPU times section (v3+, after symbol table):
//   cpu_count    uint64
//   per entry:
//     tid          uint32
//     cpu_100ns    uint64

static constexpr uint64_t kMagic   = 0x52545153544B5200ULL;
static constexpr uint32_t kVersion = 3;

namespace {

std::mutex g_mu;
std::unique_ptr<Sampler> g_sampler;
RpcRouter* g_router = nullptr;


std::wstring utf8_to_wide(std::string_view s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring out(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n);
    return out;
}

template<class T>
void write_pod(std::ofstream& f, const T& v) {
    f.write(reinterpret_cast<const char*>(&v), sizeof(T));
}

template<class T>
void read_pod(std::ifstream& f, T& v) {
    f.read(reinterpret_cast<char*>(&v), sizeof(T));
    if (!f) throw std::runtime_error("unexpected end of file");
}


std::wstring show_save_dialog() {
    wchar_t buf[MAX_PATH] = {};
    OPENFILENAMEW ofn     = {};
    ofn.lStructSize  = sizeof(ofn);
    ofn.lpstrFilter  = L"Stackr Capture (*.stackr)\0*.stackr\0All Files (*.*)\0*.*\0\0";
    ofn.lpstrFile    = buf;
    ofn.nMaxFile     = MAX_PATH;
    ofn.lpstrDefExt  = L"stackr";
    ofn.lpstrTitle   = L"Save Stackr Capture";
    ofn.Flags        = OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR;
    if (!GetSaveFileNameW(&ofn)) return {};
    return buf;
}

std::wstring show_open_dialog() {
    wchar_t buf[MAX_PATH] = {};
    OPENFILENAMEW ofn     = {};
    ofn.lStructSize  = sizeof(ofn);
    ofn.lpstrFilter  = L"Stackr Capture (*.stackr)\0*.stackr\0All Files (*.*)\0*.*\0\0";
    ofn.lpstrFile    = buf;
    ofn.nMaxFile     = MAX_PATH;
    ofn.lpstrTitle   = L"Open Stackr Capture";
    ofn.Flags        = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    if (!GetOpenFileNameW(&ofn)) return {};
    return buf;
}

std::string serialize_stats(const Stats& s) {
    json::Writer w;
    w.begin_object();
    w.key("pid");             w.value_uint(s.pid);
    w.key("frequencyHz");     w.value_uint(s.frequency_hz);
    w.key("samplesTotal");    w.value_uint(s.samples_total);
    w.key("samplesDropped");  w.value_uint(s.samples_dropped);
    w.key("threadsActive");   w.value_uint(s.threads_active);
    w.key("threadsSeen");     w.value_uint(s.threads_seen);
    w.key("walkFailures");    w.value_uint(s.walk_failures);
    w.key("elapsedMs");       w.value_uint(s.elapsed_ms);
    w.key("running");         w.value_bool(s.running);
    w.end_object();
    return w.take();
}

std::string handle_start(std::string_view params) {
    Config cfg{};
    if (auto v = json::find_field(params, "pid")) {
        auto n = json::as_int(*v);
        if (!n || *n <= 0) throw std::runtime_error("invalid 'pid'");
        cfg.pid = static_cast<uint32_t>(*n);
    } else {
        throw std::runtime_error("missing 'pid'");
    }
    if (auto v = json::find_field(params, "frequencyHz")) {
        auto n = json::as_int(*v);
        if (!n) throw std::runtime_error("invalid 'frequencyHz'");
        cfg.frequency_hz = static_cast<uint32_t>(*n);
    }
    if (auto v = json::find_field(params, "durationMs")) {
        auto n = json::as_int(*v);
        if (n && *n > 0) cfg.duration_ms = static_cast<uint32_t>(*n);
    }
    if (auto v = json::find_field(params, "maxDepth")) {
        auto n = json::as_int(*v);
        if (n && *n > 0 && *n <= kMaxFrames) cfg.max_depth = static_cast<uint16_t>(*n);
    }

    std::lock_guard lk(g_mu);
    if (g_sampler && g_sampler->snapshot_stats().running) {
        throw std::runtime_error("sampler already running — call sampler.stop first");
    }
    g_sampler = std::make_unique<Sampler>();
    std::string err;
    if (!g_sampler->start(cfg, g_router, err)) {
        g_sampler.reset();
        throw std::runtime_error(err);
    }
    return serialize_stats(g_sampler->snapshot_stats());
}

std::string handle_stop(std::string_view) {
    std::lock_guard lk(g_mu);
    if (!g_sampler) return "{\"running\":false}";
    g_sampler->stop();
    // keep g_sampler alive: analysis reads samples after stop; next start() replaces it.
    return serialize_stats(g_sampler->snapshot_stats());
}

std::string handle_stats(std::string_view) {
    std::lock_guard lk(g_mu);
    if (!g_sampler) return "{\"running\":false}";
    return serialize_stats(g_sampler->snapshot_stats());
}


std::string handle_save(std::string_view params) {
    // Optional explicit path param; otherwise show Win32 Save dialog.
    std::wstring path;
    if (auto v = json::find_field(params, "path"); v && v->size() > 2) {
        path = utf8_to_wide(json::unquote(*v));
    } else {
        path = show_save_dialog();
    }
    if (path.empty()) return "{\"cancelled\":true}";

    std::vector<Sample> samples;
    std::unordered_map<uint32_t, uint64_t> cpu_times;
    uint64_t elapsed = 0;
    uint32_t pid     = 0;
    {
        std::lock_guard lk(g_mu);
        if (!g_sampler)
            throw std::runtime_error("no active capture to save");
        if (g_sampler->snapshot_stats().running)
            throw std::runtime_error("stop the capture before saving");
        auto stats = g_sampler->snapshot_stats();
        pid        = stats.pid;
        elapsed    = stats.elapsed_ms;
        samples    = g_sampler->take_samples();
        cpu_times  = g_sampler->cpu_times_100ns();
    }
    if (samples.empty()) throw std::runtime_error("capture has no samples");

    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f) throw std::runtime_error("cannot create file");

    write_pod(f, kMagic);
    write_pod(f, kVersion);
    write_pod(f, pid);
    write_pod(f, elapsed);
    const uint64_t count = static_cast<uint64_t>(samples.size());
    write_pod(f, count);
    for (const auto& s : samples) {
        write_pod(f, s.timestamp_ns);
        write_pod(f, s.tid);
        write_pod(f, s.depth);
        write_pod(f, s.truncated);
        f.write(reinterpret_cast<const char*>(s.frames.data()),
                s.depth * sizeof(uint64_t));
    }

    std::unordered_set<uint64_t> unique_addrs;
    for (const auto& s : samples) {
        for (uint16_t i = 0; i < s.depth; ++i) {
            unique_addrs.insert(s.frames[i]);
        }
    }

    auto* resolver = symbols::borrow_resolver(pid);
    if (resolver) {
        std::vector<std::pair<uint64_t, symbols::ResolvedFrame>> sym_table;
        sym_table.reserve(unique_addrs.size());
        for (uint64_t addr : unique_addrs) {
            sym_table.emplace_back(addr, resolver->resolve(addr));
        }

        const uint64_t sym_count = static_cast<uint64_t>(sym_table.size());
        write_pod(f, sym_count);
        for (const auto& [addr, rf] : sym_table) {
            write_pod(f, addr);
            const uint32_t fn_len  = static_cast<uint32_t>(rf.function.size());
            const uint32_t mod_len = static_cast<uint32_t>(rf.module_name.size());
            const uint32_t src_len = static_cast<uint32_t>(rf.source_file.size());
            write_pod(f, fn_len);
            write_pod(f, mod_len);
            write_pod(f, src_len);
            f.write(rf.function.data(),    fn_len);
            f.write(rf.module_name.data(), mod_len);
            f.write(rf.source_file.data(), src_len);
            write_pod(f, rf.module_base);
            write_pod(f, rf.displacement);
            write_pod(f, rf.source_line);
        }
    } else {
        write_pod(f, uint64_t{0}); // sym_count = 0
    }

    write_pod(f, static_cast<uint64_t>(cpu_times.size()));
    for (const auto& [tid, cpu_100ns] : cpu_times) {
        write_pod(f, tid);
        write_pod(f, cpu_100ns);
    }

    if (!f) throw std::runtime_error("write failed");

    json::Writer w;
    w.begin_object();
    w.key("path");        w.value_wstring(path);
    w.key("sampleCount"); w.value_uint(count);
    w.end_object();
    return w.take();
}

std::string handle_load(std::string_view params) {
    std::wstring path;
    if (auto v = json::find_field(params, "path"); v && v->size() > 2) {
        path = utf8_to_wide(json::unquote(*v));
    } else {
        path = show_open_dialog();
    }
    if (path.empty()) return "{\"cancelled\":true}";

    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("cannot open file");

    uint64_t magic = 0;   read_pod(f, magic);
    if (magic != kMagic)  throw std::runtime_error("not a valid Stackr capture file");

    uint32_t version = 0; read_pod(f, version);
    if (version < 1 || version > 3) throw std::runtime_error("unsupported capture version");

    uint32_t pid     = 0; read_pod(f, pid);
    uint64_t elapsed = 0; read_pod(f, elapsed);
    uint64_t count   = 0; read_pod(f, count);

    if (count > 50'000'000ULL) throw std::runtime_error("file claims too many samples");

    std::vector<Sample> samples;
    samples.reserve(static_cast<size_t>(count));
    for (uint64_t i = 0; i < count; ++i) {
        Sample s{};
        read_pod(f, s.timestamp_ns);
        read_pod(f, s.tid);
        read_pod(f, s.depth);
        read_pod(f, s.truncated);
        if (s.depth > kMaxFrames) throw std::runtime_error("invalid depth in sample");
        f.read(reinterpret_cast<char*>(s.frames.data()),
               s.depth * sizeof(uint64_t));
        if (!f) throw std::runtime_error("unexpected end of file in samples");
        samples.push_back(s);
    }

    std::unordered_map<uint64_t, symbols::ResolvedFrame> sym_map;
    if (version >= 2) {
        uint64_t sym_count = 0; read_pod(f, sym_count);
        if (sym_count > 10'000'000ULL) throw std::runtime_error("file claims too many symbols");
        sym_map.reserve(static_cast<size_t>(sym_count));
        for (uint64_t i = 0; i < sym_count; ++i) {
            uint64_t addr    = 0; read_pod(f, addr);
            uint32_t fn_len  = 0; read_pod(f, fn_len);
            uint32_t mod_len = 0; read_pod(f, mod_len);
            uint32_t src_len = 0; read_pod(f, src_len);
            if (fn_len > 65536 || mod_len > 65536 || src_len > 65536)
                throw std::runtime_error("invalid symbol entry");
            symbols::ResolvedFrame rf;
            rf.addr = addr;
            rf.function.resize(fn_len);
            if (fn_len)  f.read(rf.function.data(), fn_len);
            rf.module_name.resize(mod_len);
            if (mod_len) f.read(rf.module_name.data(), mod_len);
            rf.source_file.resize(src_len);
            if (src_len) f.read(rf.source_file.data(), src_len);
            if (!f) throw std::runtime_error("unexpected end of file in symbol table");
            read_pod(f, rf.module_base);
            read_pod(f, rf.displacement);
            read_pod(f, rf.source_line);
            sym_map.emplace(addr, std::move(rf));
        }
    }

    // Read CPU times section (v3+).
    std::unordered_map<uint32_t, uint64_t> cpu_times;
    if (version >= 3) {
        uint64_t cpu_count = 0; read_pod(f, cpu_count);
        if (cpu_count > 1'000'000ULL) throw std::runtime_error("file claims too many cpu entries");
        cpu_times.reserve(static_cast<size_t>(cpu_count));
        for (uint64_t i = 0; i < cpu_count; ++i) {
            uint32_t tid      = 0; read_pod(f, tid);
            uint64_t cpu_100ns = 0; read_pod(f, cpu_100ns);
            cpu_times.emplace(tid, cpu_100ns);
        }
    }

    symbols::inject_offline_symbols(pid, std::move(sym_map));

    {
        std::lock_guard lk(g_mu);
        if (g_sampler && g_sampler->snapshot_stats().running)
            throw std::runtime_error("stop the current capture before loading a file");
        g_sampler = std::make_unique<Sampler>();
        g_sampler->load_capture(pid, elapsed, std::move(samples), std::move(cpu_times));
    }

    if (g_router) {
        json::Writer ev;
        ev.begin_object();
        ev.key("pid");          ev.value_uint(pid);
        ev.key("samplesTotal"); ev.value_uint(count);
        ev.key("elapsedMs");    ev.value_uint(elapsed);
        ev.key("fromFile");     ev.value_bool(true);
        ev.end_object();
        g_router->emit("sampler.stopped", ev.str());
    }

    json::Writer w;
    w.begin_object();
    w.key("pid");         w.value_uint(pid);
    w.key("sampleCount"); w.value_uint(count);
    w.key("elapsedMs");   w.value_uint(elapsed);
    w.key("path");        w.value_wstring(path);
    w.end_object();
    return w.take();
}

} // namespace (anonymous)

void register_methods(RpcRouter& r) {
    g_router = &r;
    r.on("sampler.start",  handle_start);
    r.on("sampler.stop",   handle_stop);
    r.on("sampler.stats",  handle_stats);
    r.on("capture.save",   handle_save);
    r.on("capture.load",   handle_load);
}

std::vector<Sample> take_samples(uint32_t pid) {
    std::lock_guard lk(g_mu);
    if (!g_sampler) return {};
    if (g_sampler->snapshot_stats().pid != pid) return {};
    return g_sampler->take_samples();
}

uint64_t elapsed_ms(uint32_t pid) {
    std::lock_guard lk(g_mu);
    if (!g_sampler) return 0;
    auto s = g_sampler->snapshot_stats();
    return s.pid == pid ? s.elapsed_ms : 0;
}

std::unordered_map<uint32_t, uint64_t> cpu_times_100ns(uint32_t pid) {
    std::lock_guard lk(g_mu);
    if (!g_sampler) return {};
    if (g_sampler->snapshot_stats().pid != pid) return {};
    return g_sampler->cpu_times_100ns();
}

} // namespace stackr::sampler
