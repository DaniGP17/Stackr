#include "methods.h"

#include <stdexcept>

#include "attacher.h"
#include "enumerator.h"
#include "launcher.h"
#include "registry.h"
#include "types.h"

#include "../ipc/rpc_router.h"
#include "../symbols/search_path.h"
#include "../symbols/session.h"
#include "../util/json.h"
#include "../util/logging.h"

#include <tlhelp32.h>

namespace stackr::process {

namespace {

const char* bitness_str(Bitness b) {
    switch (b) {
    case Bitness::X64:   return "x64";
    case Bitness::X86:   return "x86";
    case Bitness::Arm64: return "arm64";
    default:             return "unknown";
    }
}

std::string serialize_process(const ProcessInfo& p) {
    json::Writer w;
    w.begin_object();
    w.key("pid");          w.value_uint(p.pid);
    w.key("parentPid");    w.value_uint(p.parent_pid);
    w.key("name");         w.value_wstring(p.name);
    w.key("path");         w.value_wstring(p.image_path);
    w.key("threads");      w.value_uint(p.thread_count);
    w.key("sessionId");    w.value_uint(p.session_id);
    w.key("bitness");      w.value_string(bitness_str(p.bitness));
    w.key("elevated");     w.value_bool(p.elevated);
    w.key("accessible");   w.value_bool(p.accessible);
    w.end_object();
    return w.take();
}

std::string handle_list(std::string_view params) {
    bool fill_paths = true;
    if (auto v = json::find_field(params, "withPaths")) {
        fill_paths = (*v == "true");
    }
    auto items = enumerate(fill_paths);

    json::Writer w;
    w.begin_array();
    for (auto& p : items) w.value_raw(serialize_process(p));
    w.end_array();
    return w.take();
}

std::string handle_attach(std::string_view params) {
    auto pid_v = json::find_field(params, "pid");
    if (!pid_v) throw std::runtime_error("missing 'pid' parameter");
    auto pid_n = json::as_int(*pid_v);
    if (!pid_n || *pid_n <= 0) throw std::runtime_error("invalid 'pid'");

    auto a = attach(static_cast<uint32_t>(*pid_n));
    if (!a.handle) {
        DWORD err = GetLastError();
        throw std::runtime_error("OpenProcess failed (Win32 error " + std::to_string(err) + ")");
    }

    uint32_t pid    = a.pid;
    HANDLE   handle = a.handle;
    Registry::instance().put(std::move(a));

    std::string sym_err;
    auto search = symbols::default_search_path();
    if (!symbols::SessionRegistry::instance().ensure(pid, handle, search, sym_err)) {
        logging::warn("symbol session failed for pid {}: {}", pid, sym_err);
    }

    json::Writer w;
    w.begin_object();
    w.key("pid"); w.value_uint(pid);
    w.key("attached"); w.value_bool(true);
    w.end_object();
    return w.take();
}

std::string handle_detach(std::string_view params) {
    auto pid_v = json::find_field(params, "pid");
    if (!pid_v) throw std::runtime_error("missing 'pid' parameter");
    auto pid_n = json::as_int(*pid_v);
    if (!pid_n) throw std::runtime_error("invalid 'pid'");

    uint32_t pid = static_cast<uint32_t>(*pid_n);
    symbols::SessionRegistry::instance().drop(pid);
    bool ok = Registry::instance().drop(pid);
    return ok ? "{\"detached\":true}" : "{\"detached\":false}";
}

std::string handle_launch(std::string_view params) {
    LaunchOptions opts;

    auto path = json::find_field(params, "path");
    if (!path) throw std::runtime_error("missing 'path' parameter");
    auto path_s = json::unquote(*path);
    int n = MultiByteToWideChar(CP_UTF8, 0, path_s.data(), (int)path_s.size(), nullptr, 0);
    opts.image_path.resize(n);
    MultiByteToWideChar(CP_UTF8, 0, path_s.data(), (int)path_s.size(), opts.image_path.data(), n);

    if (auto args = json::find_field(params, "args")) {
        auto s = json::unquote(*args);
        int m = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
        opts.args.resize(m);
        MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), opts.args.data(), m);
    }
    if (auto cwd = json::find_field(params, "cwd")) {
        auto s = json::unquote(*cwd);
        int m = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
        opts.working_dir.resize(m);
        MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), opts.working_dir.data(), m);
    }
    if (auto sus = json::find_field(params, "startSuspended")) {
        opts.start_suspended = (*sus == "true");
    }

    std::wstring err;
    auto r = launch(opts, err);
    if (!r) {
        int cb = WideCharToMultiByte(CP_UTF8, 0, err.data(), (int)err.size(),
                                     nullptr, 0, nullptr, nullptr);
        std::string msg(cb, '\0');
        WideCharToMultiByte(CP_UTF8, 0, err.data(), (int)err.size(),
                            msg.data(), cb, nullptr, nullptr);
        throw std::runtime_error("launch failed: " + msg);
    }

    AttachedHandle h;
    h.pid    = r->pid;
    h.handle = r->process_handle;   // we adopt ownership
    HANDLE handle = h.handle;
    Registry::instance().put(std::move(h));
    if (r->thread_handle) CloseHandle(r->thread_handle);

    std::string sym_err;
    auto search = symbols::default_search_path();
    if (!symbols::SessionRegistry::instance().ensure(r->pid, handle, search, sym_err)) {
        logging::warn("symbol session failed for launched pid {}: {}", r->pid, sym_err);
    }

    json::Writer w;
    w.begin_object();
    w.key("pid"); w.value_uint(r->pid);
    w.key("tid"); w.value_uint(r->tid);
    w.end_object();
    return w.take();
}

std::string handle_threads(std::string_view params) {
    auto pid_v = json::find_field(params, "pid");
    if (!pid_v) throw std::runtime_error("missing 'pid'");
    auto pid_n = json::as_int(*pid_v);
    if (!pid_n || *pid_n <= 0) throw std::runtime_error("invalid 'pid'");
    DWORD target_pid = static_cast<DWORD>(*pid_n);

    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snap == INVALID_HANDLE_VALUE)
        throw std::runtime_error("CreateToolhelp32Snapshot failed");

    json::Writer w;
    w.begin_object();
    w.key("pid");     w.value_uint(target_pid);
    w.key("threads"); w.begin_array();

    THREADENTRY32 te{ sizeof(te) };
    if (Thread32First(snap, &te)) {
        do {
            if (te.th32OwnerProcessID != target_pid) continue;

            std::wstring name;
            int priority = THREAD_PRIORITY_NORMAL;

            HANDLE ht = OpenThread(THREAD_QUERY_LIMITED_INFORMATION, FALSE, te.th32ThreadID);
            if (ht && ht != INVALID_HANDLE_VALUE) {
                PWSTR desc = nullptr;
                if (SUCCEEDED(GetThreadDescription(ht, &desc)) && desc) {
                    name = desc;
                    LocalFree(desc);
                }
                int p = GetThreadPriority(ht);
                if (p != THREAD_PRIORITY_ERROR_RETURN) priority = p;
                CloseHandle(ht);
            }

            w.begin_object();
            w.key("tid");      w.value_uint(te.th32ThreadID);
            w.key("name");     w.value_wstring(name);
            w.key("priority"); w.value_int(priority);
            w.end_object();

        } while (Thread32Next(snap, &te));
    }
    CloseHandle(snap);

    w.end_array();
    w.end_object();
    return w.take();
}

} // namespace

void register_methods(RpcRouter& r) {
    enable_debug_privilege();

    r.on("process.list",    handle_list);
    r.on("process.attach",  handle_attach);
    r.on("process.detach",  handle_detach);
    r.on("process.launch",  handle_launch);
    r.on("process.threads", handle_threads);

    logging::info("process RPC methods registered");
}

} // namespace stackr::process
