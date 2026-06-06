#pragma once

#include <windows.h>
#include <wrl.h>
#include <deque>
#include <memory>
#include <mutex>
#include <string>

#include "WebView2.h"

#include "virtual_host.h"

namespace stackr {

// WM_STACKR_FLUSH: wakes the UI thread to drain the outbound JSON queue.
// ICoreWebView2 methods must be called from the UI thread only.
constexpr UINT WM_STACKR_FLUSH = WM_APP + 1;

class RpcRouter;

class WebViewHost {
public:
    WebViewHost(HWND parent, std::shared_ptr<RpcRouter> rpc);
    ~WebViewHost();

    WebViewHost(const WebViewHost&) = delete;
    WebViewHost& operator=(const WebViewHost&) = delete;

    bool initialize();
    void resize(const RECT& bounds);
    void navigate(const std::wstring& url);

    void post_to_web(const std::string& json_utf8);
    void flush_outbound();

    void set_zoom_factor(double factor);
    double zoom_factor() const;

private:
    HRESULT on_environment_created(HRESULT, ICoreWebView2Environment*);
    HRESULT on_controller_created(HRESULT, ICoreWebView2Controller*);
    HRESULT on_web_message_received(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs*);

    HWND parent_{};
    RECT bounds_{};
    std::shared_ptr<RpcRouter> rpc_;
    std::unique_ptr<VirtualHost> virtual_host_;

    Microsoft::WRL::ComPtr<ICoreWebView2Environment> env_;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller_;
    Microsoft::WRL::ComPtr<ICoreWebView2> webview_;

    EventRegistrationToken msg_token_{};
    EventRegistrationToken request_token_{};

    std::mutex                out_mu_;
    std::deque<std::wstring>  out_queue_;
};

} // namespace stackr
