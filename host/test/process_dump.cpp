// Minimal CLI to validate the process enumerator end-to-end without spinning
// up the WebView2 host. Build target: stackr_test_process_dump
// Usage: stackr_test_process_dump [--no-paths]

#include <cstdio>
#include <cstring>
#include <windows.h>

#include "../src/process/enumerator.h"
#include "../src/process/attacher.h"

int wmain(int argc, wchar_t** argv) {
    bool fill_paths = true;
    for (int i = 1; i < argc; ++i) {
        if (wcscmp(argv[i], L"--no-paths") == 0) fill_paths = false;
    }

    SetConsoleOutputCP(CP_UTF8);
    stackr::process::enable_debug_privilege();

    auto t0 = GetTickCount64();
    auto list = stackr::process::enumerate(fill_paths);
    auto dt = GetTickCount64() - t0;

    std::printf("enumerated %zu processes in %llu ms (fill_paths=%s)\n",
        list.size(), static_cast<unsigned long long>(dt), fill_paths ? "true" : "false");

    int accessible = 0, x64 = 0;
    for (auto& p : list) {
        if (p.accessible) ++accessible;
        if (p.bitness == stackr::process::Bitness::X64) ++x64;
    }
    std::printf("  accessible: %d   x64: %d\n", accessible, x64);

    // Print first 15 accessible x64 entries (the realistic profile target set).
    std::printf("\n  %-32s %8s %6s %6s %s\n", "name", "pid", "thr", "bits", "path");
    int shown = 0;
    for (auto& p : list) {
        if (!p.accessible) continue;
        if (p.bitness != stackr::process::Bitness::X64) continue;
        char name[64] = "?";
        WideCharToMultiByte(CP_UTF8, 0, p.name.c_str(), -1, name, sizeof(name), nullptr, nullptr);
        char path[256] = "";
        if (!p.image_path.empty()) {
            WideCharToMultiByte(CP_UTF8, 0, p.image_path.c_str(), -1, path, sizeof(path), nullptr, nullptr);
        }
        std::printf("  %-32s %8u %6u %6s %s\n", name, p.pid, p.thread_count, "x64", path);
        if (++shown >= 15) break;
    }

    return 0;
}
