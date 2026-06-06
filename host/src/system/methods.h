#pragma once

namespace stackr {
class RpcRouter;
class WebViewHost;

namespace system_rpc {

void register_methods(RpcRouter& r, WebViewHost& host);

} // namespace system_rpc
} // namespace stackr
