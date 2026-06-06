#pragma once

#include <windows.h>
#include <cstdint>
#include <memory>
#include <mutex>
#include <unordered_map>

#include "attacher.h"

namespace stackr::process {

class Registry {
public:
    static Registry& instance();

    void put(AttachedHandle&& h);
    bool drop(uint32_t pid);
    HANDLE borrow(uint32_t pid);

private:
    Registry() = default;
    std::mutex mu_;
    std::unordered_map<uint32_t, AttachedHandle> by_pid_;
};

} // namespace stackr::process
