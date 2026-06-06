#pragma once

#include <cstdint>
#include <list>
#include <mutex>
#include <unordered_map>
#include <vector>

#include "session.h"
#include "types.h"

namespace stackr::symbols {

class Resolver {
public:
    explicit Resolver(Session& session, size_t cache_capacity = 65536);
    explicit Resolver(std::unordered_map<uint64_t, ResolvedFrame> table);

    const ResolvedFrame& resolve(uint64_t addr);
    void resolve_many(const uint64_t* addrs, size_t n, std::vector<ResolvedFrame>& out);

    struct Stats {
        uint64_t hits      = 0;
        uint64_t misses    = 0;
        uint64_t evictions = 0;
        size_t   size      = 0;
        size_t   capacity  = 0;
    };
    Stats stats() const;

private:
    const ResolvedFrame& do_resolve_locked(uint64_t addr);

    Session* session_ = nullptr;
    const size_t capacity_;
    mutable std::mutex cache_mu_;
    using Entry = std::pair<uint64_t, ResolvedFrame>;
    std::list<Entry> lru_;
    std::unordered_map<uint64_t, std::list<Entry>::iterator> index_;

    bool offline_ = false;
    std::unordered_map<uint64_t, ResolvedFrame> offline_table_;

    uint64_t hits_      = 0;
    uint64_t misses_    = 0;
    uint64_t evictions_ = 0;
};

} // namespace stackr::symbols
