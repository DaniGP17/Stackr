#pragma once

#include <cstdint>
#include <string>

namespace stackr::symbols {

struct ResolvedFrame {
    uint64_t     addr        = 0;
    uint64_t     module_base = 0;
    std::string  module_name;
    std::string  function;
    std::string  source_file;
    uint32_t     source_line  = 0;
    uint32_t     displacement = 0;
    bool         is_inline    = false;
};

struct FunctionId {
    uint64_t module_base = 0;
    uint64_t function_rva = 0;

    bool operator==(const FunctionId& o) const noexcept {
        return module_base == o.module_base && function_rva == o.function_rva;
    }
};

struct FunctionIdHash {
    size_t operator()(const FunctionId& f) const noexcept {
        uint64_t h = f.module_base * 0x9E3779B97F4A7C15ull;
        h ^= f.function_rva + 0x517CC1B727220A95ull + (h << 6) + (h >> 2);
        return static_cast<size_t>(h);
    }
};

inline FunctionId function_id_of(const ResolvedFrame& f) {
    return { f.module_base, f.addr - f.displacement };
}

} // namespace stackr::symbols
