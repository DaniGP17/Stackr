#include "app.h"

#include <dwmapi.h>
#include <commctrl.h>

#include "webview/webview_host.h"
#include "ipc/rpc_router.h"
#include "process/methods.h"
#include "sampler/methods.h"
#include "symbols/methods.h"
#include "analysis/methods.h"
#include "disasm/methods.h"
#include "system/methods.h"
#include "util/json.h"
#include "util/logging.h"

#pragma comment(lib, "Dwmapi.lib")

namespace stackr {

namespace {

void register_default_methods(RpcRouter& r) {
    r.on("ping", [](std::string_view) -> std::string {
        return "\"pong\"";
    });

    r.on("system.info", [](std::string_view) -> std::string {
        std::string out;
        out += "{\"version\":\"0.1.0\"}";
        return out;
    });

    process::register_methods(r);
    sampler::register_methods(r);
    symbols::register_methods(r);
    analysis::register_methods(r);
    disasm::register_methods(r);
}

} // namespace

namespace {
constexpr wchar_t kClassName[]  = L"StackrMainWindow";
constexpr wchar_t kWindowTitle[] = L"Stackr";
constexpr int kInitialWidth  = 1400;
constexpr int kInitialHeight = 900;
} // namespace

App::App(HINSTANCE hInstance, LPWSTR cmd_line, int show_cmd)
    : hinstance_(hInstance),
      show_cmd_(show_cmd),
      cmd_line_(cmd_line ? cmd_line : L"") {}

App::~App() = default;

int App::run() {
    INITCOMMONCONTROLSEX icc{ sizeof(icc), ICC_STANDARD_CLASSES };
    InitCommonControlsEx(&icc);

    register_class();
    create_window();

    rpc_ = std::make_shared<RpcRouter>();
    register_default_methods(*rpc_);
    webview_ = std::make_unique<WebViewHost>(hwnd_, rpc_);
    system_rpc::register_methods(*rpc_, *webview_);

    if (!webview_->initialize()) {
        MessageBoxW(hwnd_,
            L"Failed to initialize WebView2.\n\n"
            L"Make sure the WebView2 runtime is installed:\n"
            L"https://developer.microsoft.com/microsoft-edge/webview2/",
            L"Stackr", MB_ICONERROR | MB_OK);
        return 1;
    }

    ShowWindow(hwnd_, show_cmd_);
    UpdateWindow(hwnd_);

    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return static_cast<int>(msg.wParam);
}

void App::register_class() {
    WNDCLASSEXW wc{};
    wc.cbSize        = sizeof(wc);
    wc.style         = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc   = &App::wnd_proc_thunk;
    wc.hInstance     = hinstance_;
    wc.hCursor       = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(0, 0, 0));
    wc.lpszClassName = kClassName;
    wc.hIcon         = LoadIconW(hinstance_, IDI_APPLICATION);
    wc.hIconSm       = LoadIconW(hinstance_, IDI_APPLICATION);
    RegisterClassExW(&wc);
}

void App::create_window() {
    hwnd_ = CreateWindowExW(
        0,
        kClassName,
        kWindowTitle,
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT,
        kInitialWidth, kInitialHeight,
        nullptr, nullptr, hinstance_, this);

    apply_dark_titlebar();
}

void App::apply_dark_titlebar() {
    // DWMWA_USE_IMMERSIVE_DARK_MODE is 20 on Win10 2004+; no named constant before SDK 10.0.22000
    BOOL dark = TRUE;
    DwmSetWindowAttribute(hwnd_, 20, &dark, sizeof(dark));
}

LRESULT CALLBACK App::wnd_proc_thunk(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    App* self = nullptr;
    if (msg == WM_NCCREATE) {
        auto* cs = reinterpret_cast<CREATESTRUCTW*>(lp);
        self = static_cast<App*>(cs->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    } else {
        self = reinterpret_cast<App*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    }
    if (self) return self->wnd_proc(hwnd, msg, wp, lp);
    return DefWindowProcW(hwnd, msg, wp, lp);
}

LRESULT App::wnd_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_SIZE:
        if (webview_) {
            RECT rc; GetClientRect(hwnd, &rc);
            webview_->resize(rc);
        }
        return 0;
    case WM_STACKR_FLUSH:
        if (webview_) webview_->flush_outbound();
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

} // namespace stackr
