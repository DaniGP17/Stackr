#pragma once

#include <windows.h>
#include <cstdint>

namespace stackr::process {

bool enable_debug_privilege();

struct AttachedHandle {
    uint32_t pid    = 0;
    HANDLE   handle = nullptr;

    ~AttachedHandle() { if (handle) CloseHandle(handle); }
    AttachedHandle() = default;
    AttachedHandle(AttachedHandle&& o) noexcept : pid(o.pid), handle(o.handle) {
        o.pid = 0; o.handle = nullptr;
    }
    AttachedHandle& operator=(AttachedHandle&& o) noexcept {
        if (handle) CloseHandle(handle);
        pid = o.pid; handle = o.handle;
        o.pid = 0; o.handle = nullptr;
        return *this;
    }
    AttachedHandle(const AttachedHandle&) = delete;
    AttachedHandle& operator=(const AttachedHandle&) = delete;
};

AttachedHandle attach(uint32_t pid);

} // namespace stackr::process
