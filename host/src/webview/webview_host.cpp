#include "webview_host.h"

#include <wrl/event.h>
#include <shlobj.h>
#include <pathcch.h>

#include "ipc/rpc_router.h"
#include "util/logging.h"

#pragma comment(lib, "Pathcch.lib")
#pragma comment(lib, "Shell32.lib")

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace stackr {

namespace {

std::wstring user_data_folder() {
    PWSTR local{};
    SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local);
    std::wstring path = local ? local : L"";
    CoTaskMemFree(local);
    if (path.empty()) return L"StackrWebViewData";
    path += L"\\Stackr\\WebView2";
    return path;
}

std::string wide_to_utf8(std::wstring_view w) {
    if (w.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string out(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), out.data(), n, nullptr, nullptr);
    return out;
}

std::wstring utf8_to_wide(std::string_view s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring out(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n);
    return out;
}

} // namespace

WebViewHost::WebViewHost(HWND parent, std::shared_ptr<RpcRouter> rpc)
    : parent_(parent), rpc_(std::move(rpc)) {
    GetClientRect(parent_, &bounds_);
    virtual_host_ = std::make_unique<VirtualHost>();
}

WebViewHost::~WebViewHost() {
    if (webview_) {
        webview_->remove_WebMessageReceived(msg_token_);
        webview_->remove_WebResourceRequested(request_token_);
    }
    if (controller_) controller_->Close();
}

bool WebViewHost::initialize() {
    auto user_data = user_data_folder();

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, user_data.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                return on_environment_created(result, env);
            }).Get());

    if (FAILED(hr)) {
        logging::error("CreateCoreWebView2EnvironmentWithOptions failed: 0x{:08x}", static_cast<unsigned>(hr));
        return false;
    }

    rpc_->set_sender([this](const std::string& json) {
        post_to_web(json);
    });

    return true;
}

HRESULT WebViewHost::on_environment_created(HRESULT result, ICoreWebView2Environment* env) {
    if (FAILED(result) || !env) {
        logging::error("WebView2 environment creation failed: 0x{:08x}", static_cast<unsigned>(result));
        return result;
    }
    env_ = env;

    return env_->CreateCoreWebView2Controller(parent_,
        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [this](HRESULT r, ICoreWebView2Controller* c) -> HRESULT {
                return on_controller_created(r, c);
            }).Get());
}

HRESULT WebViewHost::on_controller_created(HRESULT result, ICoreWebView2Controller* controller) {
    if (FAILED(result) || !controller) {
        logging::error("WebView2 controller creation failed: 0x{:08x}", static_cast<unsigned>(result));
        return result;
    }
    controller_ = controller;
    controller_->get_CoreWebView2(&webview_);

    {
        double zoom = 1.25;
        wchar_t buf[32];
        if (DWORD n = GetEnvironmentVariableW(L"STACKR_ZOOM", buf, ARRAYSIZE(buf));
            n > 0 && n < ARRAYSIZE(buf))
        {
            double v = _wtof(buf);
            if (v >= 0.25 && v <= 4.0) zoom = v;
        }
        controller_->put_ZoomFactor(zoom);
    }

    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(controller_.As(&controller2))) {
        COREWEBVIEW2_COLOR bg{ 0xFF, 0x00, 0x00, 0x00 };
        controller2->put_DefaultBackgroundColor(bg);
    }

    ComPtr<ICoreWebView2Settings> settings;
    webview_->get_Settings(&settings);
    if (settings) {
        settings->put_AreDevToolsEnabled(TRUE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
        settings->put_IsBuiltInErrorPageEnabled(TRUE);

        ComPtr<ICoreWebView2Settings3> settings3;
        if (SUCCEEDED(settings.As(&settings3))) {
            settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
        }
    }

    webview_->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this](ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                return on_web_message_received(sender, args);
            }).Get(),
        &msg_token_);

    const wchar_t* bootstrap = LR"JS(
        (function () {
          if (!window.chrome || !window.chrome.webview) return;
          window.__stackrSend = (msg) => window.chrome.webview.postMessage(msg);
          window.chrome.webview.addEventListener('message', (ev) => {
            window.dispatchEvent(new CustomEvent('stackr:message', { detail: ev.data }));
          });
        })();
    )JS";
    webview_->AddScriptToExecuteOnDocumentCreated(bootstrap, nullptr);

#ifdef STACKR_DEV_SERVER
    const std::wstring start_url = L"http://localhost:3000/";
    logging::info("STACKR_DEV_SERVER mode — navigating to dev server");
#else
    if (virtual_host_) virtual_host_->attach(webview_.Get(), request_token_);
    const std::wstring start_url = L"https://stackr.local/index.html";
#endif

    resize(bounds_);
    controller_->put_IsVisible(TRUE);
    webview_->Navigate(start_url.c_str());

    return S_OK;
}

HRESULT WebViewHost::on_web_message_received(
    ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args)
{
    LPWSTR raw_json = nullptr;
    if (FAILED(args->get_WebMessageAsJson(&raw_json)) || !raw_json) {
        return S_OK;
    }
    std::wstring json_w = raw_json;
    CoTaskMemFree(raw_json);

    auto utf8 = wide_to_utf8(json_w);
    if (rpc_) rpc_->on_message_from_web(utf8);
    return S_OK;
}

void WebViewHost::post_to_web(const std::string& json_utf8) {
    auto w = utf8_to_wide(json_utf8);
    {
        std::lock_guard lk(out_mu_);
        out_queue_.push_back(std::move(w));
    }
    if (parent_) PostMessageW(parent_, WM_STACKR_FLUSH, 0, 0);
}

void WebViewHost::flush_outbound() {
    if (!webview_) return;
    std::deque<std::wstring> batch;
    {
        std::lock_guard lk(out_mu_);
        batch.swap(out_queue_);
    }
    for (auto& msg : batch) {
        webview_->PostWebMessageAsJson(msg.c_str());
    }
}

void WebViewHost::set_zoom_factor(double factor) {
    if (!controller_) return;
    if (factor < 0.25) factor = 0.25;
    if (factor > 4.0)  factor = 4.0;
    controller_->put_ZoomFactor(factor);
}

double WebViewHost::zoom_factor() const {
    if (!controller_) return 1.0;
    double f = 1.0;
    controller_->get_ZoomFactor(&f);
    return f;
}

void WebViewHost::resize(const RECT& bounds) {
    bounds_ = bounds;
    if (controller_) controller_->put_Bounds(bounds_);
}

void WebViewHost::navigate(const std::wstring& url) {
    if (webview_) webview_->Navigate(url.c_str());
}

} // namespace stackr
