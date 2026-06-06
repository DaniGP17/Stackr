#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

#include "types.h"

namespace stackr {
class RpcRouter;

namespace sampler {

void register_methods(RpcRouter& r);

std::vector<Sample> take_samples(uint32_t pid);
uint64_t            elapsed_ms(uint32_t pid);
std::unordered_map<uint32_t, uint64_t> cpu_times_100ns(uint32_t pid);

} // namespace sampler
} // namespace stackr
