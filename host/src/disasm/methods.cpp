#include "methods.h"

#include <stdexcept>

#include "disassembler.h"

#include "../ipc/rpc_router.h"
#include "../process/registry.h"
#include "../util/json.h"

namespace stackr::disasm {

namespace {

std::string handle_function(std::string_view params) {
    auto pid_v = json::find_field(params, "pid");
    if (!pid_v) throw std::runtime_error("missing 'pid'");
    auto pid_n = json::as_int(*pid_v);
    if (!pid_n || *pid_n <= 0) throw std::runtime_error("invalid 'pid'");
    uint32_t pid = static_cast<uint32_t>(*pid_n);

    auto addr_v = json::find_field(params, "addr");
    if (!addr_v) throw std::runtime_error("missing 'addr'");
    auto addr_n = json::as_int(*addr_v);
    if (!addr_n || *addr_n <= 0) throw std::runtime_error("invalid 'addr'");
    uint64_t addr = static_cast<uint64_t>(*addr_n);

    uint32_t max_bytes = 256;
    if (auto v = json::find_field(params, "maxBytes")) {
        if (auto n = json::as_int(*v); n && *n > 0) max_bytes = static_cast<uint32_t>(*n);
    }

    HANDLE proc = process::Registry::instance().borrow(pid);
    if (!proc) throw std::runtime_error("pid not attached — call process.attach first");

    auto listing = disassemble_function(proc, addr, max_bytes);

    json::Writer w;
    w.begin_object();
    w.key("baseAddr");  w.value_uint(listing.base_addr);
    w.key("bytesRead"); w.value_uint(listing.bytes_read);
    if (!listing.error.empty()) {
        w.key("error"); w.value_string(listing.error);
    }
    w.key("instructions");
    w.begin_array();
    for (const auto& i : listing.instructions) {
        w.begin_object();
        w.key("addr");     w.value_uint(i.addr);
        w.key("size");     w.value_uint(i.size);

        std::string hex;
        hex.reserve(i.size * 3);
        for (uint8_t b = 0; b < i.size; ++b) {
            char buf[4];
            std::snprintf(buf, sizeof(buf), "%02X ", i.bytes[b]);
            hex.append(buf, 3);
        }
        if (!hex.empty()) hex.pop_back(); // trailing space

        w.key("bytes");    w.value_string(hex);
        w.key("mnemonic"); w.value_string(i.mnemonic);
        w.key("opStr");    w.value_string(i.op_str);
        w.end_object();
    }
    w.end_array();
    w.end_object();
    return w.take();
}

} // namespace

void register_methods(RpcRouter& r) {
    r.on("disasm.function", handle_function);
}

} // namespace stackr::disasm
