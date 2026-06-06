#include "flat_profile.h"

#include <algorithm>
#include <format>
#include <unordered_map>
#include <unordered_set>

#include "../symbols/types.h"

namespace stackr::analysis {

FlatProfile build_flat_profile(const std::vector<sampler::Sample>& samples,
                               symbols::Resolver& resolver,
                               uint32_t pid,
                               uint64_t elapsed_ms,
                               uint32_t tid_filter,
                               const std::unordered_map<uint32_t, uint64_t>& cpu_times) {
    FlatProfile p;
    p.pid        = pid;
    p.tid_filter = tid_filter;
    p.elapsed_ms = elapsed_ms;

    std::unordered_map<uint32_t, uint64_t> by_tid;
    by_tid.reserve(64);
    for (const auto& s : samples) {
        ++by_tid[s.tid];
    }
    p.threads.reserve(by_tid.size());
    for (auto& [tid, n] : by_tid) {
        ThreadStat ts;
        ts.tid          = tid;
        ts.sample_count = n;
        if (auto it = cpu_times.find(tid); it != cpu_times.end()) {
            ts.cpu_100ns = it->second;
        }
        p.threads.push_back(ts);
    }
    std::sort(p.threads.begin(), p.threads.end(),
              [](const ThreadStat& a, const ThreadStat& b) {
                  if (a.cpu_100ns    != b.cpu_100ns)    return a.cpu_100ns    > b.cpu_100ns;
                  if (a.sample_count != b.sample_count) return a.sample_count > b.sample_count;
                  return a.tid < b.tid;
              });

    struct Agg {
        std::string function;
        std::string module;
        uint64_t    addr_start = 0;
        uint64_t    self  = 0;
        uint64_t    total = 0;
    };
    std::unordered_map<symbols::FunctionId, Agg, symbols::FunctionIdHash> by_fn;
    by_fn.reserve(4096);

    std::unordered_set<symbols::FunctionId, symbols::FunctionIdHash> seen_in_sample;
    seen_in_sample.reserve(64);

    uint64_t filtered_total = 0;
    for (const auto& s : samples) {
        if (tid_filter != 0 && s.tid != tid_filter) continue;
        ++filtered_total;
        if (s.depth == 0) {
            ++p.samples_unresolved;
            continue;
        }
        seen_in_sample.clear();

        for (uint16_t i = 0; i < s.depth; ++i) {
            const auto& rf = resolver.resolve(s.frames[i]);
            auto id = symbols::function_id_of(rf);

            if (seen_in_sample.insert(id).second) {
                auto& agg = by_fn[id];
                ++agg.total;
                if (agg.function.empty()) {
                    agg.function   = rf.function.empty() ? std::string{} : rf.function;
                    agg.module     = rf.module_name;
                    agg.addr_start = rf.addr - rf.displacement;
                }
            }

            if (i == 0) {
                auto& agg = by_fn[id];
                ++agg.self;
            }
        }
    }

    p.entries.reserve(by_fn.size());
    for (auto& [id, agg] : by_fn) {
        FlatEntry e;
        e.function    = agg.function.empty()
                      ? std::format("sub_{:X}", agg.addr_start)
                      : agg.function;
        e.module      = agg.module;
        e.addr_start  = agg.addr_start;
        e.self_count  = agg.self;
        e.total_count = agg.total;
        p.entries.push_back(std::move(e));
    }
    std::sort(p.entries.begin(), p.entries.end(),
              [](const FlatEntry& a, const FlatEntry& b) {
                  if (a.self_count  != b.self_count)  return a.self_count  > b.self_count;
                  if (a.total_count != b.total_count) return a.total_count > b.total_count;
                  return a.function < b.function;
              });

    p.samples_total = filtered_total;
    return p;
}

} // namespace stackr::analysis
