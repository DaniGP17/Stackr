#include "sampler.h"

#include <tlhelp32.h>
#include <unordered_set>

#include <vector>

#include "stackwalk.h"

#include "../ipc/rpc_router.h"
#include "../process/registry.h"
#include "../symbols/session.h"
#include "../util/json.h"
#include "../util/logging.h"

namespace stackr::sampler {

inline constexpr size_t kInitialReserve = 16384;

}

namespace stackr::sampler {

namespace {

uint64_t now_ns() {
    static LARGE_INTEGER freq = []{
        LARGE_INTEGER f; QueryPerformanceFrequency(&f); return f;
    }();
    LARGE_INTEGER c; QueryPerformanceCounter(&c);
    return static_cast<uint64_t>((c.QuadPart * 1'000'000'000ull) / freq.QuadPart);
}

} // namespace

Sampler::Sampler() = default;

Sampler::~Sampler() {
    stop();
}

bool Sampler::start(const Config& cfg, RpcRouter* router_for_events, std::string& err) {
    if (worker_.joinable()) {
        err = "sampler already running";
        return false;
    }
    if (cfg.frequency_hz == 0 || cfg.frequency_hz > 8000) {
        err = "frequency must be in (0, 8000] Hz";
        return false;
    }

    HANDLE target = process::Registry::instance().borrow(cfg.pid);
    if (!target) {
        err = "target PID is not attached — call process.attach first";
        return false;
    }

    cfg_         = cfg;
    target_proc_ = target;
    router_      = router_for_events;

    {
        std::lock_guard lk(samples_mu_);
        samples_.clear();
        samples_.reserve(kInitialReserve);
    }
    {
        std::lock_guard lk(cpu_mu_);
        cpu_state_.clear();
    }

    if (!symbols::SessionRegistry::instance().get(cfg.pid)) {
        err = "no symbol session for pid — attach the process first";
        return false;
    }

    samples_total_.store(0);
    walk_failures_.store(0);
    threads_active_.store(0);
    threads_seen_.store(0);
    start_time_ = std::chrono::steady_clock::now();
    stop_.store(false);

    worker_ = std::thread([this]{ run(); });
    logging::info("sampler started: pid={} freq={}Hz depth<={}",
                  cfg_.pid, cfg_.frequency_hz, cfg_.max_depth);
    return true;
}

void Sampler::stop() {
    if (!worker_.joinable()) return;
    stop_.store(true);
    worker_.join();
    target_proc_ = nullptr;

    size_t n;
    {
        std::lock_guard lk(samples_mu_);
        n = samples_.size();
    }
    logging::info("sampler stopped: {} samples collected, {} walk failures",
                  n, walk_failures_.load());
}

void Sampler::load_capture(uint32_t pid, uint64_t elapsed_ms, std::vector<Sample> samples,
                            std::unordered_map<uint32_t, uint64_t> cpu_times) {
    cfg_.pid            = pid;
    loaded_capture_     = true;
    loaded_elapsed_ms_  = elapsed_ms;

    std::unordered_set<uint32_t> tids;
    for (auto& s : samples) tids.insert(s.tid);
    samples_total_.store(samples.size(), std::memory_order_relaxed);
    threads_seen_.store(static_cast<uint32_t>(tids.size()), std::memory_order_relaxed);

    {
        std::lock_guard cpu_lk(cpu_mu_);
        cpu_state_.clear();
        for (auto& [tid, cpu_100ns] : cpu_times) {
            cpu_state_[tid] = { 0, cpu_100ns };
        }
    }

    std::lock_guard lk(samples_mu_);
    samples_ = std::move(samples);
}

std::vector<Sample> Sampler::take_samples() {
    std::lock_guard lk(samples_mu_);
    return samples_;
}

std::unordered_map<uint32_t, uint64_t> Sampler::cpu_times_100ns() {
    std::lock_guard lk(cpu_mu_);
    std::unordered_map<uint32_t, uint64_t> out;
    out.reserve(cpu_state_.size());
    for (auto& [tid, st] : cpu_state_) {
        out.emplace(tid, st.accumulated_100ns);
    }
    return out;
}

void Sampler::run() {
    const uint64_t period_ns = 1'000'000'000ull / cfg_.frequency_hz;

    uint64_t next_progress = GetTickCount64() + 250;

    // CREATE_WAITABLE_TIMER_HIGH_RESOLUTION (Win10 1803+) lets us fire above the 64 Hz system tick without timeBeginPeriod(1).
    HANDLE timer = CreateWaitableTimerExW(
        nullptr, nullptr,
        CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
        TIMER_ALL_ACCESS);
    if (!timer) timer = CreateWaitableTimerW(nullptr, FALSE, nullptr);

    const uint64_t start_ns = now_ns();
    uint64_t       next_due_ns = start_ns + period_ns;

    while (!stop_.load()) {
        const uint64_t before_now = now_ns();
        if (before_now < next_due_ns) {
            LARGE_INTEGER due{};
            due.QuadPart = -static_cast<LONGLONG>((next_due_ns - before_now) / 100);
            SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE);
            WaitForSingleObject(timer, INFINITE);
            if (stop_.load()) break;
        }

        uint32_t walked = sample_one_cycle();
        threads_active_.store(walked);

        next_due_ns += period_ns;

        // Resync if we fall more than 1 s behind to avoid burst catch-up.
        const uint64_t after_now = now_ns();
        if (after_now > next_due_ns + 1'000'000'000ull) {
            next_due_ns = after_now + period_ns;
        }

        if (cfg_.duration_ms > 0) {
            auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - start_time_).count();
            if (static_cast<uint64_t>(elapsed_ms) >= cfg_.duration_ms) break;
        }

        uint64_t now = GetTickCount64();
        if (router_ && now >= next_progress) {
            next_progress = now + 250;
            auto s = snapshot_stats();
            json::Writer w;
            w.begin_object();
            w.key("pid");             w.value_uint(cfg_.pid);
            w.key("samplesTotal");    w.value_uint(s.samples_total);
            w.key("samplesDropped");  w.value_uint(s.samples_dropped);
            w.key("threadsActive");   w.value_uint(s.threads_active);
            w.key("threadsSeen");     w.value_uint(s.threads_seen);
            w.key("walkFailures");    w.value_uint(s.walk_failures);
            w.key("elapsedMs");       w.value_uint(s.elapsed_ms);
            w.end_object();
            router_->emit("sampler.progress", w.str());
        }
    }
    CancelWaitableTimer(timer);
    CloseHandle(timer);

    if (router_) {
        auto s = snapshot_stats();
        json::Writer w;
        w.begin_object();
        w.key("pid");           w.value_uint(cfg_.pid);
        w.key("samplesTotal");  w.value_uint(s.samples_total);
        w.key("samplesDropped");w.value_uint(s.samples_dropped);
        w.key("threadsActive"); w.value_uint(s.threads_active);
        w.key("threadsSeen");   w.value_uint(s.threads_seen);
        w.key("walkFailures");  w.value_uint(s.walk_failures);
        w.key("elapsedMs");     w.value_uint(s.elapsed_ms);
        w.end_object();
        router_->emit("sampler.stopped", w.str());
    }
}

uint32_t Sampler::sample_one_cycle() {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;

    const DWORD self_tid = GetCurrentThreadId();
    const DWORD self_pid = GetCurrentProcessId();

    THREADENTRY32 te{};
    te.dwSize = sizeof(te);
    uint32_t walked = 0;
    uint32_t seen   = 0;

    if (Thread32First(snap, &te)) {
        do {
            if (te.th32OwnerProcessID != cfg_.pid) continue;
            if (cfg_.skip_self_pid && te.th32OwnerProcessID == self_pid) continue;
            if (te.th32ThreadID == self_tid) continue;

            ++seen;

            HANDLE h = OpenThread(
                THREAD_GET_CONTEXT | THREAD_SUSPEND_RESUME | THREAD_QUERY_LIMITED_INFORMATION,
                FALSE, te.th32ThreadID);
            if (!h) continue;

            DWORD prev = SuspendThread(h);
            if (prev == static_cast<DWORD>(-1)) {
                CloseHandle(h);
                continue;
            }

            CONTEXT ctx{};
            ctx.ContextFlags = CONTEXT_FULL;
            BOOL got = GetThreadContext(h, &ctx);
            // Resume before DbgHelp: StackWalk64 can block and must not hold a suspended thread.
            ResumeThread(h);

            if (!got) {
                walk_failures_.fetch_add(1, std::memory_order_relaxed);
                CloseHandle(h);
                continue;
            }

            Sample s{};
            s.timestamp_ns = now_ns();
            s.tid          = te.th32ThreadID;
            bool truncated = false;
            s.depth = walk(target_proc_, h, ctx, s.frames.data(),
                           cfg_.max_depth, truncated);
            s.truncated = truncated ? 1 : 0;

            FILETIME creation, exit, kernel, user;
            if (GetThreadTimes(h, &creation, &exit, &kernel, &user)) {
                const uint64_t total_100ns =
                    (static_cast<uint64_t>(kernel.dwHighDateTime) << 32 | kernel.dwLowDateTime) +
                    (static_cast<uint64_t>(user.dwHighDateTime)   << 32 | user.dwLowDateTime);
                std::lock_guard lk(cpu_mu_);
                auto& st = cpu_state_[te.th32ThreadID];
                if (st.last_total_100ns != 0 && total_100ns > st.last_total_100ns) {
                    st.accumulated_100ns += total_100ns - st.last_total_100ns;
                }
                st.last_total_100ns = total_100ns;
            }

            CloseHandle(h);

            if (s.depth == 0) {
                walk_failures_.fetch_add(1, std::memory_order_relaxed);
                continue;
            }

            {
                std::lock_guard lk(samples_mu_);
                samples_.push_back(s);
            }
            samples_total_.fetch_add(1, std::memory_order_relaxed);
            ++walked;
        } while (Thread32Next(snap, &te));
    }

    CloseHandle(snap);
    threads_seen_.store(seen);
    return walked;
}

Stats Sampler::snapshot_stats() {
    Stats s;
    s.pid             = cfg_.pid;
    s.frequency_hz    = cfg_.frequency_hz;
    s.samples_total   = samples_total_.load();
    s.samples_dropped = 0;
    s.threads_active  = threads_active_.load();
    s.threads_seen    = threads_seen_.load();
    s.walk_failures   = walk_failures_.load();
    s.elapsed_ms      = loaded_capture_ ? loaded_elapsed_ms_ :
                          static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
                              std::chrono::steady_clock::now() - start_time_).count());
    s.running         = worker_.joinable();
    return s;
}

} // namespace stackr::sampler
