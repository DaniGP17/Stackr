#pragma once

#include <windows.h>
#include <cstdint>

#include "types.h"

namespace stackr::sampler {

uint16_t walk(HANDLE proc, HANDLE thread, const CONTEXT& ctx_in,
              uint64_t* out_frames, uint16_t max_depth, bool& truncated);

} // namespace stackr::sampler
