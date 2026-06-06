#pragma once

#include <format>
#include <string>
#include <string_view>

namespace stackr::logging {

void init();

enum class Level { Info, Warn, Error };

void log(Level level, std::string_view message);

template <class... Args>
void info(std::format_string<Args...> fmt, Args&&... args) {
    log(Level::Info, std::format(fmt, std::forward<Args>(args)...));
}
template <class... Args>
void warn(std::format_string<Args...> fmt, Args&&... args) {
    log(Level::Warn, std::format(fmt, std::forward<Args>(args)...));
}
template <class... Args>
void error(std::format_string<Args...> fmt, Args&&... args) {
    log(Level::Error, std::format(fmt, std::forward<Args>(args)...));
}

} // namespace stackr::logging
