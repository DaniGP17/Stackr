#include "search_path.h"

#include <windows.h>
#include <shlobj.h>

#include <filesystem>
#include <mutex>
#include <system_error>

#include "../util/logging.h"

namespace stackr::symbols {

namespace {

std::mutex g_cfg_mu;
UserConfig g_user_cfg;

std::wstring local_appdata() {
    PWSTR path = nullptr;
    SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &path);
    std::wstring out = path ? path : L"";
    CoTaskMemFree(path);
    return out;
}

std::wstring env(const wchar_t* name) {
    wchar_t buf[32768];
    DWORD n = GetEnvironmentVariableW(name, buf, ARRAYSIZE(buf));
    if (n == 0 || n >= ARRAYSIZE(buf)) return {};
    return std::wstring(buf, n);
}

} // namespace

std::wstring ensure_local_cache_dir() {
    auto root = local_appdata();
    if (root.empty()) root = L".";
    std::wstring dir = root + L"\\Stackr\\Symbols";
    SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
    return dir;
}

std::wstring default_search_path() {
    UserConfig cfg = get_user_config();
    std::wstring path;
    path.reserve(256);

    for (const auto& d : cfg.extra_paths) {
        if (d.empty()) continue;
        if (!path.empty()) path += L';';
        path += d;
    }

    if (auto env_path = env(L"_NT_SYMBOL_PATH"); !env_path.empty()) {
        if (!path.empty()) path += L';';
        path += env_path;
    } else if (cfg.include_ms_server) {
        auto cache = ensure_local_cache_dir();
        if (!path.empty()) path += L';';
        path += L"srv*";
        path += cache;
        path += L"*https://msdl.microsoft.com/download/symbols";
    }

    return path;
}

std::wstring build_search_path(const std::vector<std::wstring>& extra_dirs) {
    auto cache = ensure_local_cache_dir();
    std::wstring path;
    path.reserve(256);

    for (const auto& d : extra_dirs) {
        if (d.empty()) continue;
        if (!path.empty()) path += L';';
        path += d;
    }
    if (!path.empty()) path += L';';
    path += L"srv*";
    path += cache;
    path += L"*https://msdl.microsoft.com/download/symbols";
    return path;
}

UserConfig get_user_config() {
    std::lock_guard lk(g_cfg_mu);
    return g_user_cfg;
}

void set_user_config(const UserConfig& cfg) {
    std::lock_guard lk(g_cfg_mu);
    g_user_cfg = cfg;
}

CacheStats cache_stats() {
    CacheStats out;
    namespace fs = std::filesystem;
    std::error_code ec;
    auto dir = ensure_local_cache_dir();
    if (!fs::exists(dir, ec)) return out;
    for (fs::recursive_directory_iterator it(dir, fs::directory_options::skip_permission_denied, ec), end;
         it != end; it.increment(ec))
    {
        if (ec) { ec.clear(); continue; }
        if (!it->is_regular_file(ec)) { ec.clear(); continue; }
        auto sz = fs::file_size(it->path(), ec);
        if (ec) { ec.clear(); continue; }
        out.total_bytes += sz;
        ++out.file_count;
    }
    return out;
}

bool clear_cache(std::string& error) {
    namespace fs = std::filesystem;
    std::error_code ec;
    auto dir = ensure_local_cache_dir();
    if (!fs::exists(dir, ec)) return true;
    for (fs::directory_iterator it(dir, fs::directory_options::skip_permission_denied, ec), end;
         it != end; it.increment(ec))
    {
        if (ec) { error = ec.message(); return false; }
        fs::remove_all(it->path(), ec);
        if (ec) {
            error = ec.message();
            logging::warn("clear_cache: failed to remove entry: {}", error);
            return false;
        }
    }
    return true;
}

} // namespace stackr::symbols
