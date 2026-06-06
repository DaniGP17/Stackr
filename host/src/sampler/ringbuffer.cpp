#include "ringbuffer.h"

#include <stdexcept>

namespace stackr::sampler {

namespace {
bool is_pow2(uint32_t n) { return n > 0 && (n & (n - 1)) == 0; }
}

SampleRing::SampleRing(uint32_t capacity_pow2)
    : capacity_(capacity_pow2),
      mask_(capacity_pow2 - 1),
      buffer_(std::make_unique<Sample[]>(capacity_pow2)) {
    if (!is_pow2(capacity_pow2)) {
        throw std::invalid_argument("SampleRing capacity must be a power of two");
    }
}

SampleRing::~SampleRing() = default;

bool SampleRing::push(const Sample& s) {
    const uint64_t head = head_.load(std::memory_order_relaxed);
    const uint64_t tail = tail_.load(std::memory_order_acquire);
    if (head - tail >= capacity_) {
        dropped_.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    buffer_[head & mask_] = s;
    head_.store(head + 1, std::memory_order_release);
    return true;
}

bool SampleRing::pop(Sample& out) {
    const uint64_t tail = tail_.load(std::memory_order_relaxed);
    const uint64_t head = head_.load(std::memory_order_acquire);
    if (tail == head) return false;
    out = buffer_[tail & mask_];
    tail_.store(tail + 1, std::memory_order_release);
    return true;
}

} // namespace stackr::sampler
