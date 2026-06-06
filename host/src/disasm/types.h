#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace stackr::disasm {

struct Instruction {
    uint64_t addr     = 0;
    uint8_t  size     = 0;
    std::array<uint8_t, 15> bytes{};
    std::string mnemonic;
    std::string op_str;
};

struct Listing {
    uint64_t                 base_addr   = 0;
    uint64_t                 bytes_read  = 0;
    std::string              error;
    std::vector<Instruction> instructions;
};

} // namespace stackr::disasm
