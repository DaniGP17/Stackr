#pragma once

#include <windows.h>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <vector>

#include "types.h"

namespace stackr {
class RpcRouter;

namespace sampler {

struct Stats {
    uint64_t samples_total      = 0;
    uint64_t samples_dropped    = 0;
    uint32_t threads_seen       = 0;
    uint32_t threads_active     = 0;
    uint64_t walk_failures      = 0;
    uint64_t elapsed_ms         = 0;
    uint32_t pid                = 0;
    uint32_t frequency_hz       = 0;
    bool     running            = false;
};

struct Config {
    uint32_t pid           = 0;
    uint32_t frequency_hz  = 1000;
    uint32_t duration_ms   = 0;
    uint16_t max_depth     = 64;
    bool     skip_self_pid = true;
};

class Sampler {
public:
    Sampler();
    ~Sampler();

    Sampler(const Sampler&) = delete;
    Sampler& operator=(const Sampler&) = delete;

    bool start(const Config& cfg, RpcRouter* router_for_events, std::string& err);
    void stop();

    // Inject pre-loaded samples without starting a live sampling session.
    void load_capture(uint32_t pid, uint64_t elapsed_ms, std::vector<Sample> samples,
                      std::unordered_map<uint32_t, uint64_t> cpu_times = {});

    Stats snapshot_stats();

    std::vector<Sample> take_samples();
    std::unordered_map<uint32_t, uint64_t> cpu_times_100ns();

private:
    void run();
    uint32_t sample_one_cycle();

    Config cfg_{};
    HANDLE target_proc_ = nullptr;
    std::mutex samples_mu_;
    std::vector<Sample> samples_;

    struct CpuState {
        uint64_t last_total_100ns = 0;
        uint64_t accumulated_100ns = 0;
    };
    std::mutex cpu_mu_;
    std::unordered_map<uint32_t, CpuState> cpu_state_;

    std::thread worker_;
    std::atomic<bool> stop_{false};

    std::atomic<uint64_t> samples_total_{0};
    std::atomic<uint64_t> walk_failures_{0};
    std::atomic<uint32_t> threads_active_{0};
    std::atomic<uint32_t> threads_seen_{0};
    std::chrono::steady_clock::time_point start_time_;

    RpcRouter* router_ = nullptr;

    bool     loaded_capture_    = false;
    uint64_t loaded_elapsed_ms_ = 0;
};

} // namespace sampler
} // namespace stackr
