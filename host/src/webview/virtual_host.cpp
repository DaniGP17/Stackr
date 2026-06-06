#include "virtual_host.h"

#include <wrl/event.h>
#include <algorithm>
#include <string>

#include "web_assets_index.h"
#include "util/logging.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace stackr {

namespace {

std::wstring utf8_to_wide(std::string_view s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring out(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n);
    return out;
}

std::string wide_to_utf8(std::wstring_view w) {
    if (w.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string out(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), out.data(), n, nullptr, nullptr);
    return out;
}

std::string normalize_url_path(std::string_view path) {
    std::string p(path);
    if (auto q = p.find('?'); q != std::string::npos) p.resize(q);
    if (auto h = p.find('#'); h != std::string::npos) p.resize(h);
    if (p.empty() || p == "/") return "/index.html";
    return p;
}

} // namespace

VirtualHost::VirtualHost() = default;
VirtualHost::~VirtualHost() = default;

void VirtualHost::attach(ICoreWebView2* wv, EventRegistrationToken& out_token) {
    if (!wv) return;

    ICoreWebView2_2* wv2 = nullptr;
    if (FAILED(wv->QueryInterface(__uuidof(ICoreWebView2_2), reinterpret_cast<void**>(&wv2))) || !wv2) {
        logging::error("WebView2 too old: ICoreWebView2_2 unavailable");
        return;
    }

    wv2->get_Environment(env_.GetAddressOf());
    wv->AddWebResourceRequestedFilter(L"https://stackr.local/*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);

    wv->add_WebResourceRequested(
        Callback<ICoreWebView2WebResourceRequestedEventHandler>(
            [this](ICoreWebView2* s, ICoreWebView2WebResourceRequestedEventArgs* a) -> HRESULT {
                return on_request(s, a);
            }).Get(),
        &out_token);

    wv2->Release();
}

bool VirtualHost::lookup(std::string_view url_path, Asset& out) const {
    auto path = normalize_url_path(url_path);

    auto try_find = [&](std::string_view key) -> bool {
        for (size_t i = 0; i < web_assets::kEntryCount; ++i) {
            if (web_assets::kEntries[i].path == key) {
                HMODULE mod = GetModuleHandleW(nullptr);
                HRSRC res = FindResourceW(mod, MAKEINTRESOURCEW(web_assets::kEntries[i].resource_id), RT_RCDATA);
                if (!res) return false;
                HGLOBAL handle = LoadResource(mod, res);
                if (!handle) return false;
                out.data = LockResource(handle);
                out.size = SizeofResource(mod, res);
                out.mime = std::string(web_assets::kEntries[i].mime);
                return true;
            }
        }
        return false;
    };

    if (try_find(path)) return true;
    if (!path.empty() && path.back() != '/') {
        if (try_find(path + "/index.html")) return true;
    }
    if (try_find(path + "index.html")) return true;
    return try_find("/index.html");
}

HRESULT VirtualHost::on_request(ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) {
    ComPtr<ICoreWebView2WebResourceRequest> req;
    args->get_Request(&req);
    if (!req) return S_OK;

    LPWSTR uri_w = nullptr;
    req->get_Uri(&uri_w);
    if (!uri_w) return S_OK;
    std::string uri = wide_to_utf8(uri_w);
    CoTaskMemFree(uri_w);

    constexpr std::string_view kHost = "https://stackr.local";
    std::string path = uri.size() > kHost.size() ? uri.substr(kHost.size()) : std::string("/");

    Asset asset{};
    if (!lookup(path, asset)) {
        if (!env_) return S_OK;
        ComPtr<ICoreWebView2WebResourceResponse> resp;
        env_->CreateWebResourceResponse(nullptr, 404, L"Not Found",
            L"Content-Type: text/plain; charset=utf-8", &resp);
        args->put_Response(resp.Get());
        return S_OK;
    }

    if (!env_) return S_OK;

    ComPtr<IStream> stream;
    {
        HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, asset.size);
        if (!h) return S_OK;
        void* p = GlobalLock(h);
        memcpy(p, asset.data, asset.size);
        GlobalUnlock(h);
        CreateStreamOnHGlobal(h, TRUE, &stream);
    }

    std::wstring headers =
        L"Content-Type: " + utf8_to_wide(asset.mime) + L"\r\n"
        L"Cache-Control: no-cache\r\n"
        L"Access-Control-Allow-Origin: *";

    ComPtr<ICoreWebView2WebResourceResponse> resp;
    env_->CreateWebResourceResponse(stream.Get(), 200, L"OK", headers.c_str(), &resp);
    args->put_Response(resp.Get());
    return S_OK;
}

} // namespace stackr
