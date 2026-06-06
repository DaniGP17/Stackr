#include "attacher.h"

#include "../util/logging.h"

namespace stackr::process {

bool enable_debug_privilege() {
    HANDLE token{};
    if (!OpenProcessToken(GetCurrentProcess(),
                          TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &token)) {
        return false;
    }

    LUID luid{};
    bool ok = LookupPrivilegeValueW(nullptr, SE_DEBUG_NAME, &luid);

    if (ok) {
        TOKEN_PRIVILEGES tp{};
        tp.PrivilegeCount = 1;
        tp.Privileges[0].Luid = luid;
        tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
        AdjustTokenPrivileges(token, FALSE, &tp, sizeof(tp), nullptr, nullptr);
        ok = (GetLastError() == ERROR_SUCCESS);
        if (!ok) {
            logging::warn("SeDebugPrivilege not granted ({})", GetLastError());
        }
    }
    CloseHandle(token);
    return ok;
}

AttachedHandle attach(uint32_t pid) {
    constexpr DWORD kRights =
        PROCESS_QUERY_INFORMATION |
        PROCESS_VM_READ           |
        PROCESS_SUSPEND_RESUME    |
        PROCESS_DUP_HANDLE        |
        SYNCHRONIZE;

    HANDLE h = OpenProcess(kRights, FALSE, pid);
    if (!h) {
        h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid);
    }

    AttachedHandle out;
    out.pid    = pid;
    out.handle = h;
    return out;
}

} // namespace stackr::process
