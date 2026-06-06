#include "disassembler.h"

#include <capstone/capstone.h>

#include <algorithm>
#include <cstring>
#include <vector>

#include "../util/logging.h"

namespace stackr::disasm {

namespace {

constexpr uint32_t kHardCap = 4096;

bool read_remote(HANDLE proc, uint64_t addr, void* dst, SIZE_T want, SIZE_T& got) {
    got = 0;
    return ReadProcessMemory(proc, reinterpret_cast<LPCVOID>(addr), dst, want, &got) || got > 0;
}

} // namespace

Listing disassemble_function(HANDLE proc, uint64_t addr, uint32_t max_bytes) {
    Listing out;
    out.base_addr = addr;

    if (!proc) {
        out.error = "null target handle";
        return out;
    }
    if (max_bytes == 0) max_bytes = 256;
    if (max_bytes > kHardCap) max_bytes = kHardCap;

    std::vector<uint8_t> buf(max_bytes);
    SIZE_T got = 0;
    if (!read_remote(proc, addr, buf.data(), buf.size(), got) || got == 0) {
        DWORD err = GetLastError();
        out.error = "ReadProcessMemory failed: Win32 " + std::to_string(err);
        return out;
    }
    buf.resize(got);
    out.bytes_read = got;

    csh handle = 0;
    if (cs_open(CS_ARCH_X86, CS_MODE_64, &handle) != CS_ERR_OK) {
        out.error = "cs_open failed";
        return out;
    }
    cs_option(handle, CS_OPT_DETAIL, CS_OPT_OFF);
    cs_option(handle, CS_OPT_SYNTAX, CS_OPT_SYNTAX_INTEL);
    cs_option(handle, CS_OPT_SKIPDATA, CS_OPT_ON);

    cs_insn* insn = nullptr;
    size_t count = cs_disasm(handle, buf.data(), buf.size(), addr, 0, &insn);

    out.instructions.reserve(count);
    for (size_t i = 0; i < count; ++i) {
        Instruction ix;
        ix.addr     = insn[i].address;
        ix.size     = static_cast<uint8_t>(insn[i].size);
        std::memcpy(ix.bytes.data(), insn[i].bytes,
                    std::min<size_t>(insn[i].size, ix.bytes.size()));
        ix.mnemonic = insn[i].mnemonic;
        ix.op_str   = insn[i].op_str;
        out.instructions.push_back(std::move(ix));
    }

    if (count > 0) cs_free(insn, count);
    cs_close(&handle);

    logging::info("disassembled {} bytes @ 0x{:X} -> {} instructions",
                  out.bytes_read, addr, out.instructions.size());
    return out;
}

} // namespace stackr::disasm
