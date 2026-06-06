#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace stackr::symbols {

std::wstring default_search_path();

std::wstring build_search_path(const std::vector<std::wstring>& extra_dirs);

struct UserConfig {
    std::vector<std::wstring> extra_paths;
    bool                      include_ms_server = true;
};

UserConfig get_user_config();
void       set_user_config(const UserConfig& cfg);

std::wstring ensure_local_cache_dir();

struct CacheStats {
    uint64_t total_bytes = 0;
    uint64_t file_count  = 0;
};

CacheStats cache_stats();

bool clear_cache(std::string& error);

} // namespace stackr::symbols
