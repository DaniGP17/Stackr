#include "rpc_router.h"

#include "util/json.h"
#include "util/logging.h"

namespace stackr {

void RpcRouter::set_sender(Sender s) { sender_ = std::move(s); }

void RpcRouter::on(std::string method, Handler h) {
    std::lock_guard lk(mu_);
    handlers_.emplace(std::move(method), std::move(h));
}

void RpcRouter::emit(std::string_view event, std::string_view payload_json) {
    if (!sender_) return;
    std::string out;
    out.reserve(event.size() + payload_json.size() + 32);
    out += "{\"event\":";
    json::append_string(out, event);
    out += ",\"payload\":";
    out += payload_json.empty() ? std::string_view("null") : payload_json;
    out += "}";
    sender_(out);
}

void RpcRouter::on_message_from_web(std::string_view json) {
    auto id     = json::find_field(json, "id");
    auto method = json::find_field(json, "method");
    auto params = json::find_field(json, "params");

    if (!method.has_value() || !id.has_value()) {
        logging::warn("rpc: malformed message ({} chars)", json.size());
        return;
    }

    std::string method_str{json::unquote(*method)};
    std::string_view params_view = params.value_or("null");

    Handler handler;
    {
        std::lock_guard lk(mu_);
        auto it = handlers_.find(method_str);
        if (it != handlers_.end()) handler = it->second;
    }

    std::string response;
    response.reserve(64 + (params_view.size() / 2));
    response += "{\"id\":";
    response += *id;

    if (!handler) {
        response += ",\"error\":";
        json::append_string(response, "method not found: " + method_str);
        response += "}";
    } else {
        try {
            std::string result = handler(params_view);
            response += ",\"result\":";
            response += result.empty() ? std::string("null") : result;
            response += "}";
        } catch (const std::exception& ex) {
            response += ",\"error\":";
            json::append_string(response, ex.what());
            response += "}";
        }
    }

    if (sender_) sender_(response);
}

} // namespace stackr
