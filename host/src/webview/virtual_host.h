#pragma once

#include <windows.h>
#include <wrl.h>
#include <string>
#include <string_view>

#include "WebView2.h"

namespace stackr {

class VirtualHost {
public:
    VirtualHost();
    ~VirtualHost();

    void attach(ICoreWebView2* wv, EventRegistrationToken& out_token);

private:
    HRESULT on_request(ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs*);

    struct Asset {
        const void* data;
        size_t      size;
        std::string mime;
    };
    bool lookup(std::string_view url_path, Asset& out) const;

    Microsoft::WRL::ComPtr<ICoreWebView2Environment> env_;
};

} // namespace stackr
