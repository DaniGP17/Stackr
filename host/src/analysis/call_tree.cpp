#include "call_tree.h"

#include <algorithm>
#include <format>
#include <functional>
#include <memory>
#include <unordered_map>

#include "../symbols/types.h"

namespace stackr::analysis {

namespace {

struct TrieNode {
    std::string function;
    std::string module;
    uint64_t    addr_start  = 0;
    uint64_t    self_count  = 0;
    uint64_t    total_count = 0;
    std::unordered_map<symbols::FunctionId, std::unique_ptr<TrieNode>, symbols::FunctionIdHash> children;
};

void populate_from_frame(TrieNode& n, const symbols::ResolvedFrame& rf) {
    if (!n.function.empty()) return; // already initialized on first visit
    n.addr_start = rf.addr - rf.displacement;
    n.module     = rf.module_name;
    n.function   = rf.function.empty()
                 ? std::format("sub_{:X}", n.addr_start)
                 : rf.function;
}

CallTreeNode finalize(TrieNode& src, uint32_t depth, uint32_t max_depth,
                      uint32_t min_samples, uint32_t& next_id, uint32_t& node_count)
{
    CallTreeNode dst;
    dst.id          = next_id++;
    dst.function    = std::move(src.function);
    dst.module      = std::move(src.module);
    dst.addr_start  = src.addr_start;
    dst.self_count  = src.self_count;
    dst.total_count = src.total_count;
    ++node_count;

    if (depth >= max_depth || src.children.empty()) return dst;

    std::vector<TrieNode*> visible;
    visible.reserve(src.children.size());
    for (auto& [id, child] : src.children) {
        if (child->total_count < min_samples) continue;
        visible.push_back(child.get());
    }
    std::sort(visible.begin(), visible.end(), [](TrieNode* a, TrieNode* b) {
        return a->total_count > b->total_count;
    });

    dst.children.reserve(visible.size());
    for (TrieNode* c : visible) {
        dst.children.push_back(
            finalize(*c, depth + 1, max_depth, min_samples, next_id, node_count));
    }
    return dst;
}

} // namespace

CallTree build_call_tree(const std::vector<sampler::Sample>& samples,
                         symbols::Resolver& resolver,
                         uint32_t pid,
                         uint64_t elapsed_ms,
                         uint32_t tid_filter,
                         CallTreeMode mode,
                         uint32_t max_depth,
                         uint32_t min_samples,
                         const std::unordered_map<uint32_t, uint64_t>& cpu_times)
{
    CallTree out;
    out.pid        = pid;
    out.tid_filter = tid_filter;
    out.mode       = mode;
    out.elapsed_ms = elapsed_ms;

    {
        std::unordered_map<uint32_t, uint64_t> by_tid;
        by_tid.reserve(64);
        for (const auto& s : samples) ++by_tid[s.tid];
        out.threads.reserve(by_tid.size());
        for (auto& [tid, n] : by_tid) {
            ThreadStat ts;
            ts.tid          = tid;
            ts.sample_count = n;
            if (auto it = cpu_times.find(tid); it != cpu_times.end()) {
                ts.cpu_100ns = it->second;
            }
            out.threads.push_back(ts);
        }
        std::sort(out.threads.begin(), out.threads.end(),
                  [](const ThreadStat& a, const ThreadStat& b) {
                      if (a.cpu_100ns    != b.cpu_100ns)    return a.cpu_100ns    > b.cpu_100ns;
                      if (a.sample_count != b.sample_count) return a.sample_count > b.sample_count;
                      return a.tid < b.tid;
                  });
    }

    TrieNode root;

    uint64_t filtered_total = 0;
    for (const auto& s : samples) {
        if (tid_filter != 0 && s.tid != tid_filter) continue;
        ++filtered_total;
        if (s.depth == 0) {
            ++out.samples_unresolved;
            continue;
        }

        TrieNode* cur = &root;
        auto step = [&](uint16_t i) {
            const auto& rf = resolver.resolve(s.frames[i]);
            auto id = symbols::function_id_of(rf);
            auto& slot = cur->children[id];
            if (!slot) slot = std::make_unique<TrieNode>();
            populate_from_frame(*slot, rf);
            cur = slot.get();
            ++cur->total_count;
        };

        if (mode == CallTreeMode::TopDown) {
            for (int32_t i = static_cast<int32_t>(s.depth) - 1; i >= 0; --i) {
                step(static_cast<uint16_t>(i));
            }
        } else {
            for (uint16_t i = 0; i < s.depth; ++i) step(i);
        }
        ++cur->self_count;
    }
    out.samples_total = filtered_total;

    std::vector<TrieNode*> visible_roots;
    visible_roots.reserve(root.children.size());
    for (auto& [id, child] : root.children) {
        if (child->total_count < min_samples) continue;
        visible_roots.push_back(child.get());
    }
    std::sort(visible_roots.begin(), visible_roots.end(), [](TrieNode* a, TrieNode* b) {
        return a->total_count > b->total_count;
    });

    uint32_t next_id = 1;
    uint32_t node_count = 0;
    out.roots.reserve(visible_roots.size());
    for (TrieNode* r : visible_roots) {
        out.roots.push_back(finalize(*r, 1, max_depth, min_samples, next_id, node_count));
    }
    out.node_count = node_count;

    return out;
}

} // namespace stackr::analysis
