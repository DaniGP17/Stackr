#pragma once

#include <windows.h>
#include <memory>
#include <string>

namespace stackr {

class WebViewHost;
class RpcRouter;

class App {
public:
    App(HINSTANCE hInstance, LPWSTR cmd_line, int show_cmd);
    ~App();

    App(const App&) = delete;
    App& operator=(const App&) = delete;

    int run();

private:
    static LRESULT CALLBACK wnd_proc_thunk(HWND, UINT, WPARAM, LPARAM);
    LRESULT wnd_proc(HWND, UINT, WPARAM, LPARAM);

    void register_class();
    void create_window();
    void apply_dark_titlebar();

    HINSTANCE hinstance_{};
    int show_cmd_{};
    std::wstring cmd_line_;

    HWND hwnd_{};
    std::unique_ptr<WebViewHost> webview_;
    std::shared_ptr<RpcRouter> rpc_;
};

} // namespace stackr
