#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace stackr::analysis {

struct FlatEntry {
    std::string function;
    std::string module;
    uint64_t    addr_start = 0;
    uint64_t    self_count = 0;
    uint64_t    total_count = 0;
};

struct ThreadStat {
    uint32_t tid           = 0;
    uint64_t sample_count  = 0;
    uint64_t cpu_100ns     = 0;
};

struct FlatProfile {
    uint64_t                samples_total      = 0;
    uint64_t                samples_unresolved = 0;
    uint64_t                elapsed_ms         = 0;
    uint32_t                pid                = 0;
    uint32_t                tid_filter         = 0;
    std::vector<ThreadStat> threads;
    std::vector<FlatEntry>  entries;
};

struct CallTreeNode {
    uint32_t    id           = 0;
    std::string function;
    std::string module;
    uint64_t    addr_start   = 0;
    uint64_t    self_count   = 0;
    uint64_t    total_count  = 0;
    std::vector<CallTreeNode> children;
};

enum class CallTreeMode : uint8_t {
    TopDown  = 0,
    BottomUp = 1,
};

struct CallTree {
    uint32_t                  pid                = 0;
    uint32_t                  tid_filter         = 0;
    CallTreeMode              mode               = CallTreeMode::TopDown;
    uint64_t                  samples_total      = 0;
    uint64_t                  samples_unresolved = 0;
    uint64_t                  elapsed_ms         = 0;
    uint32_t                  node_count         = 0;
    std::vector<ThreadStat>   threads;
    std::vector<CallTreeNode> roots;
};

} // namespace stackr::analysis
