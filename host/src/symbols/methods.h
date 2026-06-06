#pragma once

#include <cstdint>
#include <unordered_map>

#include "types.h"

namespace stackr {
class RpcRouter;

namespace symbols {

class Resolver;

void register_methods(RpcRouter& r);

Resolver* borrow_resolver(uint32_t pid);
void      release_resolver(uint32_t pid);

void inject_offline_symbols(uint32_t pid, std::unordered_map<uint64_t, ResolvedFrame> table);

} // namespace symbols
} // namespace stackr
