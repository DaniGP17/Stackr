#include "enumerator.h"

#include <windows.h>
#include <winternl.h>
#include <tlhelp32.h>

#include <vector>

#include "../util/logging.h"

#ifndef SystemProcessInformation
constexpr SYSTEM_INFORMATION_CLASS kSystemProcessInformation =
    static_cast<SYSTEM_INFORMATION_CLASS>(5);
#else
constexpr SYSTEM_INFORMATION_CLASS kSystemProcessInformation = SystemProcessInformation;
#endif

namespace stackr::process {

namespace {

using NtQuerySystemInformation_t = NTSTATUS (NTAPI*)(
    SYSTEM_INFORMATION_CLASS, PVOID, ULONG, PULONG);

using IsWow64Process2_t = BOOL (WINAPI*)(HANDLE, USHORT*, USHORT*);

NtQuerySystemInformation_t load_nt_query() {
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    if (!ntdll) return nullptr;
    return reinterpret_cast<NtQuerySystemInformation_t>(
        GetProcAddress(ntdll, "NtQuerySystemInformation"));
}

IsWow64Process2_t load_is_wow64_process2() {
    HMODULE k = GetModuleHandleW(L"kernel32.dll");
    if (!k) return nullptr;
    return reinterpret_cast<IsWow64Process2_t>(GetProcAddress(k, "IsWow64Process2"));
}

Bitness classify_bitness(HANDLE h, IsWow64Process2_t fn) {
    if (!fn || !h) return Bitness::Unknown;
    USHORT process_machine = 0, native_machine = 0;
    if (!fn(h, &process_machine, &native_machine)) return Bitness::Unknown;
    if (process_machine == IMAGE_FILE_MACHINE_UNKNOWN) {
        switch (native_machine) {
        case IMAGE_FILE_MACHINE_AMD64: return Bitness::X64;
        case IMAGE_FILE_MACHINE_ARM64: return Bitness::Arm64;
        default: return Bitness::Unknown;
        }
    }
    if (process_machine == IMAGE_FILE_MACHINE_I386) return Bitness::X86;
    if (process_machine == IMAGE_FILE_MACHINE_AMD64) return Bitness::X64;
    if (process_machine == IMAGE_FILE_MACHINE_ARM64) return Bitness::Arm64;
    return Bitness::Unknown;
}

bool query_elevated(HANDLE h) {
    HANDLE token{};
    if (!OpenProcessToken(h, TOKEN_QUERY, &token)) return false;
    TOKEN_ELEVATION elev{};
    DWORD ret = 0;
    BOOL ok = GetTokenInformation(token, TokenElevation, &elev, sizeof(elev), &ret);
    CloseHandle(token);
    return ok && elev.TokenIsElevated;
}

std::wstring query_full_image_path(HANDLE h) {
    std::wstring buf;
    buf.resize(MAX_PATH);
    DWORD len = static_cast<DWORD>(buf.size());
    if (QueryFullProcessImageNameW(h, 0, buf.data(), &len)) {
        buf.resize(len);
        return buf;
    }
    buf.resize(32768);
    len = static_cast<DWORD>(buf.size());
    if (QueryFullProcessImageNameW(h, 0, buf.data(), &len)) {
        buf.resize(len);
        return buf;
    }
    return {};
}

struct SystemProcessInformation {
    ULONG       NextEntryOffset;
    ULONG       NumberOfThreads;
    LARGE_INTEGER WorkingSetPrivateSize;
    ULONG       HardFaultCount;
    ULONG       NumberOfThreadsHighWatermark;
    ULONGLONG   CycleTime;
    LARGE_INTEGER CreateTime;
    LARGE_INTEGER UserTime;
    LARGE_INTEGER KernelTime;
    UNICODE_STRING ImageName;
    LONG        BasePriority;
    HANDLE      UniqueProcessId;
    HANDLE      InheritedFromUniqueProcessId;
    ULONG       HandleCount;
    ULONG       SessionId;
    ULONG_PTR   UniqueProcessKey;
    SIZE_T      PeakVirtualSize;
    SIZE_T      VirtualSize;
    ULONG       PageFaultCount;
    SIZE_T      PeakWorkingSetSize;
    SIZE_T      WorkingSetSize;
};

} // namespace

std::vector<ProcessInfo> enumerate(bool fill_paths) {
    std::vector<ProcessInfo> out;

    auto nt_query = load_nt_query();
    if (!nt_query) {
        logging::error("NtQuerySystemInformation unavailable");
        return out;
    }

    std::vector<char> buffer;
    ULONG needed = 0;
    NTSTATUS status = 0;
    for (ULONG size = 256 * 1024; size < 16 * 1024 * 1024; size *= 2) {
        buffer.resize(size);
        status = nt_query(kSystemProcessInformation, buffer.data(), size, &needed);
        if (status == 0) break;
        if (status != static_cast<NTSTATUS>(0xC0000004)) break;
    }
    if (status != 0) {
        logging::error("NtQuerySystemInformation failed: 0x{:08x}", static_cast<unsigned>(status));
        return out;
    }

    auto is_wow64_2 = load_is_wow64_process2();

    char* p = buffer.data();
    while (true) {
        auto* info = reinterpret_cast<SystemProcessInformation*>(p);

        ProcessInfo pi;
        pi.pid          = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(info->UniqueProcessId));
        pi.parent_pid   = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(info->InheritedFromUniqueProcessId));
        pi.thread_count = info->NumberOfThreads;
        pi.session_id   = info->SessionId;
        if (info->ImageName.Buffer && info->ImageName.Length > 0) {
            pi.name.assign(info->ImageName.Buffer, info->ImageName.Length / sizeof(wchar_t));
        } else if (pi.pid == 0) {
            pi.name = L"System Idle Process";
        } else if (pi.pid == 4) {
            pi.name = L"System";
        }

        if (pi.pid != 0 && pi.pid != 4 && fill_paths) {
            HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pi.pid);
            if (h) {
                pi.accessible = true;
                pi.bitness    = classify_bitness(h, is_wow64_2);
                pi.elevated   = query_elevated(h);
                pi.image_path = query_full_image_path(h);
                CloseHandle(h);
            }
        }

        out.push_back(std::move(pi));

        if (info->NextEntryOffset == 0) break;
        p += info->NextEntryOffset;
    }

    return out;
}

} // namespace stackr::process
