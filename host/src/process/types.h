#pragma once

#include <cstdint>
#include <string>

namespace stackr::process {

enum class Bitness : uint8_t {
    Unknown = 0,
    X64     = 1,
    X86     = 2, // WOW64
    Arm64   = 3,
};

struct ProcessInfo {
    uint32_t     pid           = 0;
    uint32_t     parent_pid    = 0;
    std::wstring name;
    std::wstring image_path;
    uint32_t     thread_count   = 0;
    uint32_t     session_id     = 0;
    Bitness      bitness        = Bitness::Unknown;
    bool         elevated       = false;
    bool         accessible     = false;
};

} // namespace stackr::process
