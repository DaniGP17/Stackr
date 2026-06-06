// Sample a target process for N seconds, then aggregate into a flat profile
// using DbgHelp symbols.
//
//   sampler_smoke.exe <pid> [<seconds=3> [<hz=1000>]]

#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <thread>

#include <windows.h>

#include "../src/process/attacher.h"
#include "../src/process/registry.h"
#include "../src/sampler/sampler.h"
#include "../src/symbols/resolver.h"
#include "../src/symbols/search_path.h"
#include "../src/symbols/session.h"
#include "../src/analysis/flat_profile.h"

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: sampler_smoke.exe <pid> [seconds=3] [hz=1000]\n");
        return 1;
    }
    uint32_t pid     = static_cast<uint32_t>(_wtoi(argv[1]));
    uint32_t seconds = argc > 2 ? static_cast<uint32_t>(_wtoi(argv[2])) : 3;
    uint32_t hz      = argc > 3 ? static_cast<uint32_t>(_wtoi(argv[3])) : 1000;

    SetConsoleOutputCP(CP_UTF8);

    stackr::process::enable_debug_privilege();
    auto handle = stackr::process::attach(pid);
    if (!handle.handle) {
        std::fprintf(stderr, "attach failed: Win32 %lu\n", GetLastError());
        return 2;
    }
    HANDLE raw = handle.handle;
    stackr::process::Registry::instance().put(std::move(handle));

    // Open symbol session.
    std::string err;
    auto* session = stackr::symbols::SessionRegistry::instance().ensure(
        pid, raw, stackr::symbols::default_search_path(), err);
    if (!session) {
        std::fprintf(stderr, "session open failed: %s\n", err.c_str());
        return 4;
    }

    stackr::sampler::Config cfg{};
    cfg.pid          = pid;
    cfg.frequency_hz = hz;
    cfg.duration_ms  = seconds * 1000;
    cfg.max_depth    = stackr::sampler::kMaxFrames;

    stackr::sampler::Sampler sampler;
    if (!sampler.start(cfg, /*router*/ nullptr, err)) {
        std::fprintf(stderr, "sampler.start failed: %s\n", err.c_str());
        return 3;
    }

    std::printf("sampling pid=%u at %u Hz for %u s...\n", pid, hz, seconds);
    auto t0 = std::chrono::steady_clock::now();
    while (sampler.snapshot_stats().running) {
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        auto s = sampler.snapshot_stats();
        auto dt = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - t0).count();
        std::printf("  [%5lldms] samples=%llu thr=%u/%u\n",
            static_cast<long long>(dt),
            static_cast<unsigned long long>(s.samples_total),
            s.threads_active, s.threads_seen);
        if (s.elapsed_ms >= cfg.duration_ms) break;
    }
    sampler.stop();

    auto stats = sampler.snapshot_stats();
    auto samples = sampler.take_samples();
    std::printf("\ncaptured %zu samples in %llums (dropped %llu, walk failures %llu)\n",
                samples.size(),
                static_cast<unsigned long long>(stats.elapsed_ms),
                static_cast<unsigned long long>(stats.samples_dropped),
                static_cast<unsigned long long>(stats.walk_failures));

    // Aggregate into a flat profile.
    stackr::symbols::Resolver resolver(*session);
    auto t_resolve_start = std::chrono::steady_clock::now();
    auto profile = stackr::analysis::build_flat_profile(samples, resolver, pid, stats.elapsed_ms);
    auto t_resolve = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - t_resolve_start).count();

    auto rs = resolver.stats();
    std::printf("aggregation: %lldms; resolver hits=%llu misses=%llu (%.1f%% hit) cache=%zu/%zu\n",
        static_cast<long long>(t_resolve),
        static_cast<unsigned long long>(rs.hits),
        static_cast<unsigned long long>(rs.misses),
        rs.hits + rs.misses == 0 ? 0.0 : 100.0 * rs.hits / (rs.hits + rs.misses),
        rs.size, rs.capacity);

    std::printf("\nTOP 15 BY SELF:\n  %-50s %-20s %8s %8s\n",
                "function", "module", "self", "total");
    for (size_t i = 0; i < profile.entries.size() && i < 15; ++i) {
        const auto& e = profile.entries[i];
        char fn[51]; std::snprintf(fn, sizeof(fn), "%-50s", e.function.c_str());
        char md[21]; std::snprintf(md, sizeof(md), "%-20s", e.module.c_str());
        std::printf("  %s %s %8llu %8llu\n", fn, md,
                    static_cast<unsigned long long>(e.self_count),
                    static_cast<unsigned long long>(e.total_count));
    }
    return 0;
}
