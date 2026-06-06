#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace stackr::json {

void append_string(std::string& out, std::string_view s);

inline void append_raw(std::string& out, std::string_view raw) { out += raw; }

std::optional<std::string_view> find_field(std::string_view obj_json, std::string_view key);

std::string unquote(std::string_view value);

std::optional<long long> as_int(std::string_view value);

class Writer {
public:
    Writer();
    void begin_object();
    void end_object();
    void begin_array();
    void end_array();
    void key(std::string_view k);
    void value_string(std::string_view s);
    void value_wstring(std::wstring_view w);
    void value_int(long long n);
    void value_uint(unsigned long long n);
    void value_double(double d);
    void value_bool(bool b);
    void value_null();
    void value_raw(std::string_view raw_json);

    const std::string& str() const { return out_; }
    std::string take() { return std::move(out_); }

private:
    void maybe_comma();
    std::string out_;
    struct Frame { char closer; bool has_item = false; };
    std::vector<Frame> stack_;
    bool expect_value_ = false;
};

} // namespace stackr::json
