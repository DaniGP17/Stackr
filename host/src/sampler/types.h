#pragma once

#include <array>
#include <cstdint>

namespace stackr::sampler {

inline constexpr uint32_t kMaxFrames = 64;

struct Sample {
    uint64_t  timestamp_ns = 0;
    uint32_t  tid          = 0;
    uint16_t  depth        = 0;
    uint16_t  truncated    = 0;
    std::array<uint64_t, kMaxFrames> frames{};
};

static_assert(sizeof(Sample) == 8 + 4 + 2 + 2 + kMaxFrames * 8,
              "Sample layout drifted — adjust ring buffer sizing");

} // namespace stackr::sampler
