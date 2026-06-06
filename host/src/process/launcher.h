#pragma once

#include <windows.h>
#include <optional>
#include <string>

namespace stackr::process {

struct LaunchOptions {
    std::wstring image_path;
    std::wstring args;
    std::wstring working_dir;
    bool         start_suspended = false;
};

struct LaunchResult {
    uint32_t pid = 0;
    uint32_t tid = 0;
    HANDLE   process_handle = nullptr;
    HANDLE   thread_handle  = nullptr;
};

std::optional<LaunchResult> launch(const LaunchOptions& opts, std::wstring& error);

} // namespace stackr::process
