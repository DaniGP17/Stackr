#include "session.h"

#include <dbghelp.h>

#include "../util/logging.h"

#pragma comment(lib, "Dbghelp.lib")

namespace stackr::symbols {

Session::~Session() { close(); }

bool Session::open(HANDLE target, const std::wstring& search_path, std::string& err) {
    if (open_) {
        err = "session already open";
        return false;
    }
    if (!target) {
        err = "null target handle";
        return false;
    }

    SymSetOptions(SYMOPT_DEFERRED_LOADS | SYMOPT_LOAD_LINES |
                  SYMOPT_UNDNAME | SYMOPT_AUTO_PUBLICS);

    if (!SymInitializeW(target, search_path.empty() ? nullptr : search_path.c_str(), TRUE)) {
        DWORD code = GetLastError();
        err = "SymInitializeW failed: Win32 " + std::to_string(code);
        return false;
    }
    handle_ = target;
    open_   = true;
    logging::info("symbol session opened for handle {} (modules will be invaded)",
                  reinterpret_cast<uintptr_t>(target));
    return true;
}

void Session::close() {
    if (!open_) return;
    SymCleanup(handle_);
    open_   = false;
    handle_ = nullptr;
}

SessionRegistry& SessionRegistry::instance() {
    static SessionRegistry r;
    return r;
}

Session* SessionRegistry::ensure(uint32_t pid, HANDLE target,
                                 const std::wstring& search_path, std::string& err) {
    std::lock_guard lk(mu_);
    auto it = by_pid_.find(pid);
    if (it != by_pid_.end() && it->second->is_open()) {
        return it->second.get();
    }
    auto s = std::make_unique<Session>();
    if (!s->open(target, search_path, err)) {
        return nullptr;
    }
    Session* raw = s.get();
    by_pid_[pid] = std::move(s);
    return raw;
}

Session* SessionRegistry::get(uint32_t pid) {
    std::lock_guard lk(mu_);
    auto it = by_pid_.find(pid);
    return it == by_pid_.end() ? nullptr : it->second.get();
}

void SessionRegistry::drop(uint32_t pid) {
    std::lock_guard lk(mu_);
    by_pid_.erase(pid);
}

} // namespace stackr::symbols
