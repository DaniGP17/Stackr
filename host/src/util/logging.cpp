#include "logging.h"

#include <windows.h>
#include <cstdio>

namespace stackr::logging {

namespace {
bool g_console_attached = false;
} // namespace

void init() {
#ifdef _DEBUG
    if (AllocConsole()) {
        FILE* f;
        freopen_s(&f, "CONOUT$", "w", stdout);
        freopen_s(&f, "CONOUT$", "w", stderr);
        SetConsoleOutputCP(CP_UTF8);
        g_console_attached = true;
        std::fputs("[stackr] debug console attached\n", stdout);
    }
#endif
}

void log(Level level, std::string_view message) {
    const char* tag = "info";
    switch (level) {
    case Level::Info:  tag = "info";  break;
    case Level::Warn:  tag = "warn";  break;
    case Level::Error: tag = "error"; break;
    }
    std::string line;
    line.reserve(message.size() + 32);
    line += "[stackr] [";
    line += tag;
    line += "] ";
    line.append(message);
    line += '\n';

    OutputDebugStringA(line.c_str());
    if (g_console_attached) {
        std::fputs(line.c_str(), level == Level::Error ? stderr : stdout);
    }
}

} // namespace stackr::logging
