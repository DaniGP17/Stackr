#pragma once

#include <atomic>
#include <cstdint>
#include <memory>

#include "types.h"

namespace stackr::sampler {

class SampleRing {
public:
    explicit SampleRing(uint32_t capacity_pow2);
    ~SampleRing();

    SampleRing(const SampleRing&) = delete;
    SampleRing& operator=(const SampleRing&) = delete;

    bool push(const Sample& s);
    bool pop(Sample& out);

    uint64_t produced() const { return head_.load(std::memory_order_relaxed); }
    uint64_t consumed() const { return tail_.load(std::memory_order_relaxed); }
    uint64_t dropped()  const { return dropped_.load(std::memory_order_relaxed); }
    uint32_t capacity() const { return capacity_; }

private:
    const uint32_t capacity_;
    const uint32_t mask_;
    std::unique_ptr<Sample[]> buffer_;
    // C4324 padding warning is intentional: separate cache lines prevent false sharing.
#pragma warning(push)
#pragma warning(disable : 4324)
    alignas(64) std::atomic<uint64_t> head_{0};
    alignas(64) std::atomic<uint64_t> tail_{0};
    alignas(64) std::atomic<uint64_t> dropped_{0};
#pragma warning(pop)
};

} // namespace stackr::sampler
