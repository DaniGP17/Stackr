#include "methods.h"

#include <windows.h>

#include <memory>
#include <mutex>
#include <stdexcept>
#include <unordered_map>

#include "resolver.h"
#include "search_path.h"
#include "session.h"
#include "types.h"

#include "../ipc/rpc_router.h"
#include "../util/json.h"

namespace stackr::symbols {

namespace {

std::mutex g_resolvers_mu;
std::unordered_map<uint32_t, std::unique_ptr<Resolver>> g_resolvers;

Resolver* resolver_for(uint32_t pid) {
    std::lock_guard lk(g_resolvers_mu);
    auto it = g_resolvers.find(pid);
    if (it != g_resolvers.end()) return it->second.get();
    auto* session = SessionRegistry::instance().get(pid);
    if (!session) return nullptr;
    auto r = std::make_unique<Resolver>(*session);
    Resolver* raw = r.get();
    g_resolvers[pid] = std::move(r);
    return raw;
}

void drop_resolver(uint32_t pid) {
    std::lock_guard lk(g_resolvers_mu);
    g_resolvers.erase(pid);
}

void write_frame(json::Writer& w, const ResolvedFrame& f) {
    w.begin_object();
    w.key("addr");         w.value_uint(f.addr);
    w.key("module");       w.value_string(f.module_name);
    w.key("moduleBase");   w.value_uint(f.module_base);
    w.key("function");     w.value_string(f.function);
    w.key("displacement"); w.value_uint(f.displacement);
    w.key("source");       w.value_string(f.source_file);
    w.key("line");         w.value_uint(f.source_line);
    w.end_object();
}

std::string handle_resolve(std::string_view params) {
    auto pid_v = json::find_field(params, "pid");
    auto addrs_v = json::find_field(params, "addrs");
    if (!pid_v) throw std::runtime_error("missing 'pid'");
    if (!addrs_v) throw std::runtime_error("missing 'addrs'");
    auto pid_n = json::as_int(*pid_v);
    if (!pid_n || *pid_n <= 0) throw std::runtime_error("invalid 'pid'");

    Resolver* r = resolver_for(static_cast<uint32_t>(*pid_n));
    if (!r) throw std::runtime_error("no symbol session for pid (attach first)");

    std::string_view arr = *addrs_v;
    if (arr.empty() || arr.front() != '[') throw std::runtime_error("'addrs' must be an array");

    json::Writer w;
    w.begin_array();
    size_t i = 1;
    while (i < arr.size()) {
        while (i < arr.size() && (arr[i] == ' ' || arr[i] == ',' || arr[i] == '\t' || arr[i] == '\n' || arr[i] == '\r')) ++i;
        if (i >= arr.size() || arr[i] == ']') break;
        size_t start = i;
        while (i < arr.size() && arr[i] != ',' && arr[i] != ']') ++i;
        auto tok = arr.substr(start, i - start);
        auto n = json::as_int(tok);
        if (!n) continue;
        const auto& frame = r->resolve(static_cast<uint64_t>(*n));
        write_frame(w, frame);
    }
    w.end_array();
    return w.take();
}

std::string handle_search_path_get(std::string_view) {
    auto sp = default_search_path();
    json::Writer w;
    w.begin_object();
    w.key("path");      w.value_wstring(sp);
    w.key("cacheDir");  w.value_wstring(ensure_local_cache_dir());
    w.end_object();
    return w.take();
}

std::vector<std::string> parse_string_array(std::string_view arr) {
    std::vector<std::string> out;
    if (arr.empty() || arr.front() != '[') return out;
    size_t i = 1;
    while (i < arr.size()) {
        while (i < arr.size() &&
               (arr[i] == ' ' || arr[i] == ',' || arr[i] == '\t' ||
                arr[i] == '\n' || arr[i] == '\r')) ++i;
        if (i >= arr.size() || arr[i] == ']') break;
        if (arr[i] != '"') { ++i; continue; }
        size_t start = i;
        ++i;
        while (i < arr.size() && arr[i] != '"') {
            if (arr[i] == '\\' && i + 1 < arr.size()) i += 2;
            else                                       ++i;
        }
        if (i >= arr.size()) break;
        out.push_back(json::unquote(arr.substr(start, i - start + 1)));
        ++i;
    }
    return out;
}

std::wstring utf8_to_wide_local(std::string_view s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring out(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n);
    return out;
}

std::string handle_config_get(std::string_view) {
    UserConfig cfg = get_user_config();
    json::Writer w;
    w.begin_object();
    w.key("extraPaths");
    w.begin_array();
    for (const auto& p : cfg.extra_paths) w.value_wstring(p);
    w.end_array();
    w.key("includeMsServer");  w.value_bool(cfg.include_ms_server);
    w.key("effectivePath");    w.value_wstring(default_search_path());
    w.end_object();
    return w.take();
}

std::string handle_config_set(std::string_view params) {
    UserConfig cfg;
    if (auto v = json::find_field(params, "extraPaths")) {
        for (auto& s : parse_string_array(*v)) {
            if (s.empty()) continue;
            cfg.extra_paths.push_back(utf8_to_wide_local(s));
        }
    }
    if (auto v = json::find_field(params, "includeMsServer")) {
        cfg.include_ms_server = (*v == "true");
    } else {
        cfg.include_ms_server = true;
    }
    set_user_config(cfg);
    return handle_config_get(params);
}

std::string handle_stats(std::string_view params) {
    auto pid_v = json::find_field(params, "pid");
    if (!pid_v) throw std::runtime_error("missing 'pid'");
    auto pid_n = json::as_int(*pid_v);
    if (!pid_n) throw std::runtime_error("invalid 'pid'");

    Resolver* r = resolver_for(static_cast<uint32_t>(*pid_n));
    if (!r) return "{\"sessionOpen\":false}";
    auto s = r->stats();
    json::Writer w;
    w.begin_object();
    w.key("sessionOpen");w.value_bool(true);
    w.key("hits");       w.value_uint(s.hits);
    w.key("misses");     w.value_uint(s.misses);
    w.key("evictions");  w.value_uint(s.evictions);
    w.key("size");       w.value_uint(s.size);
    w.key("capacity");   w.value_uint(s.capacity);
    w.end_object();
    return w.take();
}

} // namespace

Resolver* borrow_resolver(uint32_t pid) { return resolver_for(pid); }
void release_resolver(uint32_t pid)     { drop_resolver(pid); }

void inject_offline_symbols(uint32_t pid, std::unordered_map<uint64_t, ResolvedFrame> table) {
    std::lock_guard lk(g_resolvers_mu);
    g_resolvers[pid] = std::make_unique<Resolver>(std::move(table));
}

void register_methods(RpcRouter& r) {
    r.on("symbols.resolve",       handle_resolve);
    r.on("symbols.searchPath",    handle_search_path_get);
    r.on("symbols.stats",         handle_stats);
    r.on("symbols.getConfig",     handle_config_get);
    r.on("symbols.setConfig",     handle_config_set);
}

} // namespace stackr::symbols
