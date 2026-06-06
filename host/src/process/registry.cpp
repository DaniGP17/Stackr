#include "registry.h"

namespace stackr::process {

Registry& Registry::instance() {
    static Registry r;
    return r;
}

void Registry::put(AttachedHandle&& h) {
    std::lock_guard lk(mu_);
    by_pid_[h.pid] = std::move(h);
}

bool Registry::drop(uint32_t pid) {
    std::lock_guard lk(mu_);
    return by_pid_.erase(pid) > 0;
}

HANDLE Registry::borrow(uint32_t pid) {
    std::lock_guard lk(mu_);
    auto it = by_pid_.find(pid);
    return it == by_pid_.end() ? nullptr : it->second.handle;
}

} // namespace stackr::process
