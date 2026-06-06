#pragma once

#include <unordered_map>

#include "../sampler/types.h"
#include "../symbols/resolver.h"

#include "types.h"

namespace stackr::analysis {

CallTree build_call_tree(const std::vector<sampler::Sample>& samples,
                         symbols::Resolver& resolver,
                         uint32_t pid,
                         uint64_t elapsed_ms,
                         uint32_t tid_filter,
                         CallTreeMode mode,
                         uint32_t max_depth = 32,
                         uint32_t min_samples = 1,
                         const std::unordered_map<uint32_t, uint64_t>& cpu_times = {});

} // namespace stackr::analysis
