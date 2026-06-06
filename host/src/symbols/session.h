#pragma once

#include <windows.h>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace stackr::symbols {

class Session {
public:
    Session() = default;
    ~Session();
    Session(const Session&)            = delete;
    Session& operator=(const Session&) = delete;

    bool open(HANDLE target, const std::wstring& search_path, std::string& err);
    void close();
    bool is_open() const { return open_; }

    HANDLE handle() const { return handle_; }
    std::mutex& mutex() { return mu_; }

private:
    HANDLE     handle_ = nullptr;
    bool       open_   = false;
    std::mutex mu_;
};

class SessionRegistry {
public:
    static SessionRegistry& instance();

    Session* ensure(uint32_t pid, HANDLE target, const std::wstring& search_path, std::string& err);
    Session* get(uint32_t pid);
    void drop(uint32_t pid);

private:
    SessionRegistry() = default;
    std::mutex mu_;
    std::unordered_map<uint32_t, std::unique_ptr<Session>> by_pid_;
};

} // namespace stackr::symbols
