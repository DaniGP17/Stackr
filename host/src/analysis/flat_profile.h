#pragma once

#include <unordered_map>

#include "../sampler/types.h"
#include "../symbols/resolver.h"

#include "types.h"

namespace stackr::analysis {

FlatProfile build_flat_profile(const std::vector<sampler::Sample>& samples,
                               symbols::Resolver& resolver,
                               uint32_t pid,
                               uint64_t elapsed_ms,
                               uint32_t tid_filter = 0,
                               const std::unordered_map<uint32_t, uint64_t>& cpu_times = {});

} // namespace stackr::analysis
