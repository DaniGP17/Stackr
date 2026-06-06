#pragma once

#include <windows.h>
#include <cstdint>

#include "types.h"

namespace stackr::disasm {

Listing disassemble_function(HANDLE target_proc, uint64_t addr, uint32_t max_bytes);

} // namespace stackr::disasm
