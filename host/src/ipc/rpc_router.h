#pragma once

#include <functional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <mutex>

namespace stackr {

class RpcRouter {
public:
    using Handler = std::function<std::string(std::string_view params_json)>;
    using Sender  = std::function<void(const std::string& json_utf8)>;

    void set_sender(Sender s);
    void on(std::string method, Handler h);
    void emit(std::string_view event, std::string_view payload_json);
    void on_message_from_web(std::string_view json);

private:
    std::mutex mu_;
    std::unordered_map<std::string, Handler> handlers_;
    Sender sender_;
};

} // namespace stackr
