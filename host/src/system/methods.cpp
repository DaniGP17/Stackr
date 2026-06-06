#include "methods.h"

#include <windows.h>
#include <shellapi.h>

#include <charconv>
#include <stdexcept>

#include "../ipc/rpc_router.h"
#include "../symbols/search_path.h"
#include "../util/json.h"
#include "../util/logging.h"
#include "../webview/webview_host.h"

#pragma comment(lib, "Shell32.lib")

namespace stackr::system_rpc {

namespace {

double parse_double(std::string_view sv) {
    double d = 0;
    auto r = std::from_chars(sv.data(), sv.data() + sv.size(), d);
    if (r.ec != std::errc{} || r.ptr == sv.data()) {
        throw std::runtime_error("not a number");
    }
    return d;
}

std::wstring utf8_to_wide(std::string_view s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring out(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n);
    return out;
}

} // namespace

void register_methods(RpcRouter& r, WebViewHost& host) {
    r.on("system.setZoom", [&host](std::string_view params) -> std::string {
        auto v = json::find_field(params, "factor");
        if (!v) throw std::runtime_error("missing 'factor'");
        double f = parse_double(*v);
        host.set_zoom_factor(f);
        json::Writer w;
        w.begin_object();
        w.key("zoom"); w.value_double(host.zoom_factor());
        w.end_object();
        return w.take();
    });

    r.on("system.zoom", [&host](std::string_view) -> std::string {
        json::Writer w;
        w.begin_object();
        w.key("zoom"); w.value_double(host.zoom_factor());
        w.end_object();
        return w.take();
    });

    r.on("system.openInExplorer", [](std::string_view params) -> std::string {
        auto path_v = json::find_field(params, "path");
        if (!path_v) throw std::runtime_error("missing 'path'");
        auto path_s = json::unquote(*path_v);
        auto w = utf8_to_wide(path_s);
        HINSTANCE rc = ShellExecuteW(nullptr, L"open", w.c_str(),
                                     nullptr, nullptr, SW_SHOWNORMAL);
        bool ok = reinterpret_cast<uintptr_t>(rc) > 32;
        if (!ok) {
            logging::warn("ShellExecute open failed for {} (rc={})",
                          path_s, reinterpret_cast<uintptr_t>(rc));
        }
        return ok ? "{\"opened\":true}" : "{\"opened\":false}";
    });

    r.on("symbols.cacheInfo", [](std::string_view) -> std::string {
        auto stats = symbols::cache_stats();
        json::Writer w;
        w.begin_object();
        w.key("dir");        w.value_wstring(symbols::ensure_local_cache_dir());
        w.key("totalBytes"); w.value_uint(stats.total_bytes);
        w.key("fileCount");  w.value_uint(stats.file_count);
        w.end_object();
        return w.take();
    });

    r.on("symbols.clearCache", [](std::string_view) -> std::string {
        std::string err;
        bool ok = symbols::clear_cache(err);
        json::Writer w;
        w.begin_object();
        w.key("cleared"); w.value_bool(ok);
        if (!ok) { w.key("error"); w.value_string(err); }
        auto stats = symbols::cache_stats();
        w.key("totalBytes"); w.value_uint(stats.total_bytes);
        w.key("fileCount");  w.value_uint(stats.file_count);
        w.end_object();
        return w.take();
    });
}

} // namespace stackr::system_rpc
