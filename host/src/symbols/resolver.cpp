#include "resolver.h"

#include <windows.h>
#include <dbghelp.h>

#include <cstring>
#include <format>

#include "../util/logging.h"

#pragma comment(lib, "Dbghelp.lib")

namespace stackr::symbols {

namespace {

constexpr size_t kMaxSymName = 512;

std::string wide_to_utf8(const wchar_t* s, size_t n) {
    if (!s || n == 0) return {};
    int cb = WideCharToMultiByte(CP_UTF8, 0, s, (int)n, nullptr, 0, nullptr, nullptr);
    std::string out(cb, '\0');
    WideCharToMultiByte(CP_UTF8, 0, s, (int)n, out.data(), cb, nullptr, nullptr);
    return out;
}

std::string basename_of(const std::wstring& path) {
    if (path.empty()) return {};
    size_t pos = path.find_last_of(L"\\/");
    std::wstring base = pos == std::wstring::npos ? path : path.substr(pos + 1);
    return wide_to_utf8(base.data(), base.size());
}

} // namespace

Resolver::Resolver(Session& session, size_t capacity)
    : session_(&session), capacity_(capacity) {}

Resolver::Resolver(std::unordered_map<uint64_t, ResolvedFrame> table)
    : session_(nullptr), capacity_(65536), offline_(true), offline_table_(std::move(table)) {}

const ResolvedFrame& Resolver::resolve(uint64_t addr) {
    std::lock_guard cache_lk(cache_mu_);
    return do_resolve_locked(addr);
}

void Resolver::resolve_many(const uint64_t* addrs, size_t n,
                            std::vector<ResolvedFrame>& out) {
    out.clear();
    out.reserve(n);
    std::lock_guard cache_lk(cache_mu_);
    for (size_t i = 0; i < n; ++i) {
        out.push_back(do_resolve_locked(addrs[i]));
    }
}

const ResolvedFrame& Resolver::do_resolve_locked(uint64_t addr) {
    if (auto it = index_.find(addr); it != index_.end()) {
        ++hits_;
        lru_.splice(lru_.begin(), lru_, it->second);
        return it->second->second;
    }
    ++misses_;

    ResolvedFrame frame;
    frame.addr = addr;

    if (offline_) {
        if (auto it = offline_table_.find(addr); it != offline_table_.end()) {
            frame = it->second;
        } else {
            frame.function = std::format("sub_{:X}", addr);
        }
    } else if (session_ && session_->is_open()) {
        std::lock_guard sym_lk(session_->mutex());
        HANDLE h = session_->handle();

        IMAGEHLP_MODULEW64 mi{};
        mi.SizeOfStruct = sizeof(mi);
        if (SymGetModuleInfoW64(h, addr, &mi)) {
            frame.module_base = mi.BaseOfImage;
            frame.module_name = basename_of(mi.ImageName[0] ? mi.ImageName : mi.LoadedImageName);
        }

        union {
            SYMBOL_INFOW info;
            char buf[sizeof(SYMBOL_INFOW) + kMaxSymName * sizeof(wchar_t)];
        } sym{};
        sym.info.SizeOfStruct = sizeof(SYMBOL_INFOW);
        sym.info.MaxNameLen   = kMaxSymName;
        DWORD64 disp64 = 0;
        if (SymFromAddrW(h, addr, &disp64, &sym.info)) {
            frame.function     = wide_to_utf8(sym.info.Name, sym.info.NameLen);
            frame.displacement = static_cast<uint32_t>(disp64);
        }

        IMAGEHLP_LINEW64 line{};
        line.SizeOfStruct = sizeof(line);
        DWORD disp32 = 0;
        if (SymGetLineFromAddrW64(h, addr, &disp32, &line) && line.FileName) {
            size_t fn_len = wcslen(line.FileName);
            frame.source_file = wide_to_utf8(line.FileName, fn_len);
            frame.source_line = line.LineNumber;
        }
    }

    lru_.emplace_front(addr, std::move(frame));
    index_[addr] = lru_.begin();

    if (lru_.size() > capacity_) {
        auto& last = lru_.back();
        index_.erase(last.first);
        lru_.pop_back();
        ++evictions_;
    }

    return lru_.front().second;
}

Resolver::Stats Resolver::stats() const {
    std::lock_guard lk(cache_mu_);
    return Stats{hits_, misses_, evictions_, lru_.size(), capacity_};
}

} // namespace stackr::symbols
