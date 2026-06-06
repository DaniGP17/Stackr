#include "launcher.h"

#include <shlwapi.h>
#include <pathcch.h>

#include "../util/logging.h"

#pragma comment(lib, "Shlwapi.lib")
#pragma comment(lib, "Pathcch.lib")

namespace stackr::process {

namespace {

std::wstring format_last_error(DWORD code) {
    LPWSTR buf = nullptr;
    DWORD len = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, code, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        reinterpret_cast<LPWSTR>(&buf), 0, nullptr);
    std::wstring out;
    if (buf) {
        out.assign(buf, len);
        while (!out.empty() && (out.back() == L'\r' || out.back() == L'\n' || out.back() == L' ')) {
            out.pop_back();
        }
        LocalFree(buf);
    }
    if (out.empty()) out = L"Win32 error " + std::to_wstring(code);
    return out;
}

std::wstring parent_directory(const std::wstring& path) {
    std::wstring p = path;
    if (FAILED(PathCchRemoveFileSpec(p.data(), p.size() + 1))) return {};
    p.resize(wcslen(p.c_str()));
    return p;
}

} // namespace

std::optional<LaunchResult> launch(const LaunchOptions& opts, std::wstring& error) {
    if (opts.image_path.empty()) {
        error = L"image_path is empty";
        return std::nullopt;
    }
    if (!PathFileExistsW(opts.image_path.c_str())) {
        error = L"image_path does not exist: " + opts.image_path;
        return std::nullopt;
    }

    // CreateProcessW mutates lpCommandLine, so we must own a writable copy.
    std::wstring cmdline = L"\"" + opts.image_path + L"\"";
    if (!opts.args.empty()) {
        cmdline += L" ";
        cmdline += opts.args;
    }

    std::wstring cwd = opts.working_dir.empty() ? parent_directory(opts.image_path) : opts.working_dir;

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};

    DWORD flags = CREATE_UNICODE_ENVIRONMENT;
    if (opts.start_suspended) flags |= CREATE_SUSPENDED;

    BOOL ok = CreateProcessW(
        opts.image_path.c_str(),
        cmdline.data(),
        nullptr, nullptr,
        FALSE,
        flags,
        nullptr,
        cwd.empty() ? nullptr : cwd.c_str(),
        &si,
        &pi);

    if (!ok) {
        DWORD err = GetLastError();
        error = format_last_error(err);
        logging::error("CreateProcessW failed: Win32 error {}", err);
        return std::nullopt;
    }

    LaunchResult r;
    r.pid            = pi.dwProcessId;
    r.tid            = pi.dwThreadId;
    r.process_handle = pi.hProcess;
    r.thread_handle  = pi.hThread;
    return r;
}

} // namespace stackr::process
