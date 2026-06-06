#include "methods.h"

#include <mutex>
#include <stdexcept>
#include <unordered_map>

#include "call_tree.h"
#include "flat_profile.h"
#include "source_view.h"

#include "../ipc/rpc_router.h"
#include "../sampler/methods.h"
#include "../sampler/sampler.h"
#include "../symbols/methods.h"
#include "../symbols/resolver.h"
#include "../util/json.h"
#include "../util/logging.h"

namespace stackr::analysis {

namespace {

inline uint64_t make_cache_key(uint32_t pid, uint32_t tid) {
    return (static_cast<uint64_t>(pid) << 32) | tid;
}

std::mutex g_cache_mu;
std::unordered_map<uint64_t, FlatProfile> g_cache;

std::string serialize(const FlatProfile& p, size_t top_n) {
    json::Writer w;
    w.begin_object();
    w.key("pid");               w.value_uint(p.pid);
    w.key("tid");
    if (p.tid_filter == 0) w.value_null();
    else                   w.value_uint(p.tid_filter);
    w.key("samplesTotal");      w.value_uint(p.samples_total);
    w.key("samplesUnresolved"); w.value_uint(p.samples_unresolved);
    w.key("elapsedMs");         w.value_uint(p.elapsed_ms);
    w.key("entryCount");        w.value_uint(p.entries.size());
    w.key("threads");
    w.begin_array();
    for (const auto& t : p.threads) {
        w.begin_object();
        w.key("tid");       w.value_uint(t.tid);
        w.key("samples");   w.value_uint(t.sample_count);
        w.key("cpu100ns");  w.value_uint(t.cpu_100ns);
        w.end_object();
    }
    w.end_array();
    w.key("entries");
    w.begin_array();
    size_t n = std::min(top_n, p.entries.size());
    for (size_t i = 0; i < n; ++i) {
        const auto& e = p.entries[i];
        w.begin_object();
        w.key("function");   w.value_string(e.function);
        w.key("module");     w.value_string(e.module);
        w.key("addr");       w.value_uint(e.addr_start);
        w.key("self");       w.value_uint(e.self_count);
        w.key("total");      w.value_uint(e.total_count);
        w.end_object();
    }
    w.end_array();
    w.end_object();
    return w.take();
}

std::string handle_flat_profile(std::string_view params) {
    auto pid_v = json::find_field(params, "pid");
    if (!pid_v) throw std::runtime_error("missing 'pid'");
    auto pid_n = json::as_int(*pid_v);
    if (!pid_n || *pid_n <= 0) throw std::runtime_error("invalid 'pid'");
    uint32_t pid = static_cast<uint32_t>(*pid_n);

    uint32_t tid_filter = 0;
    if (auto v = json::find_field(params, "tid")) {
        if (auto n = json::as_int(*v); n && *n > 0) {
            tid_filter = static_cast<uint32_t>(*n);
        }
    }

    size_t top_n = 500;
    if (auto v = json::find_field(params, "topN")) {
        if (auto n = json::as_int(*v); n && *n > 0) top_n = static_cast<size_t>(*n);
    }

    bool rebuild = false;
    if (auto v = json::find_field(params, "rebuild")) {
        rebuild = (*v == "true");
    }

    uint64_t key = make_cache_key(pid, tid_filter);
    if (!rebuild) {
        std::lock_guard lk(g_cache_mu);
        auto it = g_cache.find(key);
        if (it != g_cache.end()) return serialize(it->second, top_n);
    }

    auto samples = sampler::take_samples(pid);
    if (samples.empty()) {
        FlatProfile empty;
        empty.pid        = pid;
        empty.tid_filter = tid_filter;
        return serialize(empty, top_n);
    }

    auto* resolver = symbols::borrow_resolver(pid);
    if (!resolver) throw std::runtime_error("no symbol session for pid");

    uint64_t elapsed   = sampler::elapsed_ms(pid);
    auto     cpu_times = sampler::cpu_times_100ns(pid);
    auto     profile   = build_flat_profile(samples, *resolver, pid, elapsed, tid_filter, cpu_times);

    logging::info("flat profile built: pid={} tid={} samples={} entries={}",
                  pid, tid_filter, profile.samples_total, profile.entries.size());

    std::string out = serialize(profile, top_n);
    std::lock_guard lk(g_cache_mu);
    g_cache[key] = std::move(profile);
    return out;
}

inline uint64_t make_tree_key(uint32_t pid, uint32_t tid, CallTreeMode mode) {
    return (static_cast<uint64_t>(pid) << 33)
         | (static_cast<uint64_t>(tid) << 1)
         | (mode == CallTreeMode::TopDown ? 0u : 1u);
}

std::mutex g_tree_cache_mu;
std::unordered_map<uint64_t, CallTree> g_tree_cache;

void serialize_tree_node(json::Writer& w, const CallTreeNode& n, uint64_t samples_total) {
    w.begin_object();
    w.key("id");         w.value_uint(n.id);
    w.key("function");   w.value_string(n.function);
    w.key("module");     w.value_string(n.module);
    w.key("addr");       w.value_uint(n.addr_start);
    w.key("self");       w.value_uint(n.self_count);
    w.key("total");      w.value_uint(n.total_count);
    w.key("selfPct");    w.value_double(samples_total ? (100.0 * n.self_count  / samples_total) : 0.0);
    w.key("totalPct");   w.value_double(samples_total ? (100.0 * n.total_count / samples_total) : 0.0);
    w.key("children");
    w.begin_array();
    for (const auto& c : n.children) serialize_tree_node(w, c, samples_total);
    w.end_array();
    w.end_object();
}

std::string serialize_tree(const CallTree& t) {
    json::Writer w;
    w.begin_object();
    w.key("pid");               w.value_uint(t.pid);
    w.key("tid");
    if (t.tid_filter == 0) w.value_null();
    else                   w.value_uint(t.tid_filter);
    w.key("mode");              w.value_string(t.mode == CallTreeMode::TopDown ? "topdown" : "bottomup");
    w.key("samplesTotal");      w.value_uint(t.samples_total);
    w.key("samplesUnresolved"); w.value_uint(t.samples_unresolved);
    w.key("elapsedMs");         w.value_uint(t.elapsed_ms);
    w.key("nodeCount");         w.value_uint(t.node_count);
    w.key("threads");
    w.begin_array();
    for (const auto& th : t.threads) {
        w.begin_object();
        w.key("tid");      w.value_uint(th.tid);
        w.key("samples");  w.value_uint(th.sample_count);
        w.key("cpu100ns"); w.value_uint(th.cpu_100ns);
        w.end_object();
    }
    w.end_array();
    w.key("roots");
    w.begin_array();
    for (const auto& r : t.roots) serialize_tree_node(w, r, t.samples_total);
    w.end_array();
    w.end_object();
    return w.take();
}

std::string handle_call_tree(std::string_view params) {
    auto pid_v = json::find_field(params, "pid");
    if (!pid_v) throw std::runtime_error("missing 'pid'");
    auto pid_n = json::as_int(*pid_v);
    if (!pid_n || *pid_n <= 0) throw std::runtime_error("invalid 'pid'");
    uint32_t pid = static_cast<uint32_t>(*pid_n);

    uint32_t tid_filter = 0;
    if (auto v = json::find_field(params, "tid")) {
        if (auto n = json::as_int(*v); n && *n > 0) tid_filter = static_cast<uint32_t>(*n);
    }

    CallTreeMode mode = CallTreeMode::TopDown;
    if (auto v = json::find_field(params, "mode")) {
        auto s = json::unquote(*v);
        if (s == "bottomup") mode = CallTreeMode::BottomUp;
    }

    uint32_t max_depth   = 32;
    if (auto v = json::find_field(params, "maxDepth")) {
        if (auto n = json::as_int(*v); n && *n > 0) max_depth = static_cast<uint32_t>(*n);
    }
    uint32_t min_samples = 1;
    if (auto v = json::find_field(params, "minSamples")) {
        if (auto n = json::as_int(*v); n && *n > 0) min_samples = static_cast<uint32_t>(*n);
    }

    bool rebuild = false;
    if (auto v = json::find_field(params, "rebuild")) rebuild = (*v == "true");

    uint64_t key = make_tree_key(pid, tid_filter, mode);
    if (!rebuild) {
        std::lock_guard lk(g_tree_cache_mu);
        auto it = g_tree_cache.find(key);
        if (it != g_tree_cache.end()) return serialize_tree(it->second);
    }

    auto samples = sampler::take_samples(pid);
    if (samples.empty()) {
        CallTree empty;
        empty.pid        = pid;
        empty.tid_filter = tid_filter;
        empty.mode       = mode;
        return serialize_tree(empty);
    }

    auto* resolver = symbols::borrow_resolver(pid);
    if (!resolver) throw std::runtime_error("no symbol session for pid");

    uint64_t elapsed   = sampler::elapsed_ms(pid);
    auto     cpu_times = sampler::cpu_times_100ns(pid);
    auto tree = build_call_tree(samples, *resolver, pid, elapsed, tid_filter,
                                mode, max_depth, min_samples, cpu_times);

    logging::info("call tree built: pid={} tid={} mode={} nodes={} samples={}",
                  pid, tid_filter,
                  mode == CallTreeMode::TopDown ? "topdown" : "bottomup",
                  tree.node_count, tree.samples_total);

    std::string out = serialize_tree(tree);
    std::lock_guard lk(g_tree_cache_mu);
    g_tree_cache[key] = std::move(tree);
    return out;
}

std::string serialize_source(const SourceListing& s) {
    json::Writer w;
    w.begin_object();
    w.key("pid");              w.value_uint(s.pid);
    w.key("tid");
    if (s.tid_filter == 0) w.value_null();
    else                   w.value_uint(s.tid_filter);
    w.key("functionAddr");     w.value_uint(s.function_addr);
    w.key("moduleBase");       w.value_uint(s.function_module_base);
    w.key("function");         w.value_string(s.function);
    w.key("module");           w.value_string(s.module);
    w.key("file");             w.value_string(s.file);
    w.key("fileAvailable");    w.value_bool(s.file_available);
    w.key("fileError");        w.value_string(s.file_error);
    w.key("startLine");        w.value_uint(s.start_line);
    w.key("endLine");          w.value_uint(s.end_line);
    w.key("totalHits");        w.value_uint(s.total_hits);
    w.key("samplesNoLineInfo");w.value_uint(s.samples_no_line_info);
    w.key("lines");
    w.begin_array();
    for (const auto& l : s.lines) {
        w.begin_object();
        w.key("line"); w.value_uint(l.line);
        w.key("hits"); w.value_uint(l.hits);
        w.key("code"); w.value_string(l.code);
        w.end_object();
    }
    w.end_array();
    w.key("otherFiles");
    w.begin_array();
    for (const auto& f : s.other_files) {
        w.begin_object();
        w.key("file"); w.value_string(f.file);
        w.key("hits"); w.value_uint(f.hits);
        w.end_object();
    }
    w.end_array();
    w.end_object();
    return w.take();
}

std::string handle_source_view(std::string_view params) {
    auto pid_v  = json::find_field(params, "pid");
    auto addr_v = json::find_field(params, "addr");
    if (!pid_v)  throw std::runtime_error("missing 'pid'");
    if (!addr_v) throw std::runtime_error("missing 'addr'");
    auto pid_n  = json::as_int(*pid_v);
    auto addr_n = json::as_int(*addr_v);
    if (!pid_n  || *pid_n  <= 0) throw std::runtime_error("invalid 'pid'");
    if (!addr_n || *addr_n <= 0) throw std::runtime_error("invalid 'addr'");
    uint32_t pid          = static_cast<uint32_t>(*pid_n);
    uint64_t function_addr = static_cast<uint64_t>(*addr_n);

    uint32_t tid_filter = 0;
    if (auto v = json::find_field(params, "tid")) {
        if (auto n = json::as_int(*v); n && *n > 0) tid_filter = static_cast<uint32_t>(*n);
    }
    uint32_t ctx_lines = 10;
    if (auto v = json::find_field(params, "contextLines")) {
        if (auto n = json::as_int(*v); n && *n >= 0 && *n <= 1000) {
            ctx_lines = static_cast<uint32_t>(*n);
        }
    }

    auto samples = sampler::take_samples(pid);
    auto* resolver = symbols::borrow_resolver(pid);
    if (!resolver) throw std::runtime_error("no symbol session for pid");

    const auto& rf = resolver->resolve(function_addr);
    uint64_t module_base = rf.module_base;
    if (module_base == 0) {
        SourceListing empty;
        empty.pid           = pid;
        empty.tid_filter    = tid_filter;
        empty.function_addr = function_addr;
        empty.file_error    = "address does not belong to any known module";
        return serialize_source(empty);
    }

    auto listing = build_source_view(samples, *resolver, pid, tid_filter,
                                     module_base, function_addr, ctx_lines);

    logging::info("source view built: pid={} addr=0x{:X} hits={} lines={}",
                  pid, function_addr, listing.total_hits, listing.lines.size());
    return serialize_source(listing);
}

} // namespace

void register_methods(RpcRouter& r) {
    r.on("analysis.flatProfile", handle_flat_profile);
    r.on("analysis.callTree",    handle_call_tree);
    r.on("analysis.sourceView",  handle_source_view);
}

} // namespace stackr::analysis
