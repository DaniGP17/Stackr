#include "json.h"

#include <windows.h>

#include <charconv>
#include <cstdint>
#include <cstdio>

namespace stackr::json {

namespace {

void skip_ws(std::string_view s, size_t& i) {
    while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) ++i;
}

bool skip_string(std::string_view s, size_t& i) {
    if (i >= s.size() || s[i] != '"') return false;
    ++i;
    while (i < s.size()) {
        char c = s[i++];
        if (c == '\\') { if (i < s.size()) ++i; continue; }
        if (c == '"') return true;
    }
    return false;
}

bool skip_value(std::string_view s, size_t& i) {
    skip_ws(s, i);
    if (i >= s.size()) return false;
    char c = s[i];
    if (c == '"') return skip_string(s, i);
    if (c == '{' || c == '[') {
        char open = c, close = (c == '{') ? '}' : ']';
        int depth = 0;
        while (i < s.size()) {
            char ch = s[i];
            if (ch == '"') { if (!skip_string(s, i)) return false; continue; }
            if (ch == open) ++depth;
            else if (ch == close) { --depth; ++i; if (depth == 0) return true; continue; }
            ++i;
        }
        return false;
    }
    while (i < s.size()) {
        char ch = s[i];
        if (ch == ',' || ch == '}' || ch == ']' || ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') break;
        ++i;
    }
    return true;
}

} // namespace

void append_string(std::string& out, std::string_view s) {
    out += '"';
    for (char c : s) {
        switch (c) {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) {
                char buf[8];
                std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(static_cast<unsigned char>(c)));
                out += buf;
            } else {
                out += c;
            }
        }
    }
    out += '"';
}

std::optional<std::string_view> find_field(std::string_view obj, std::string_view key) {
    size_t i = 0;
    skip_ws(obj, i);
    if (i >= obj.size() || obj[i] != '{') return std::nullopt;
    ++i;
    while (i < obj.size()) {
        skip_ws(obj, i);
        if (i < obj.size() && obj[i] == '}') return std::nullopt;
        if (i >= obj.size() || obj[i] != '"') return std::nullopt;
        size_t key_start = i + 1;
        if (!skip_string(obj, i)) return std::nullopt;
        size_t key_end = i - 1;
        std::string_view k = obj.substr(key_start, key_end - key_start);

        skip_ws(obj, i);
        if (i >= obj.size() || obj[i] != ':') return std::nullopt;
        ++i;
        skip_ws(obj, i);
        size_t val_start = i;
        if (!skip_value(obj, i)) return std::nullopt;
        std::string_view val = obj.substr(val_start, i - val_start);

        if (k == key) return val;

        skip_ws(obj, i);
        if (i < obj.size() && obj[i] == ',') { ++i; continue; }
        return std::nullopt;
    }
    return std::nullopt;
}

std::optional<long long> as_int(std::string_view v) {
    size_t i = 0;
    while (i < v.size() && (v[i] == ' ' || v[i] == '\t')) ++i;
    long long n = 0;
    auto r = std::from_chars(v.data() + i, v.data() + v.size(), n);
    if (r.ec != std::errc{} || r.ptr == v.data() + i) return std::nullopt;
    return n;
}

Writer::Writer() { out_.reserve(256); }

void Writer::maybe_comma() {
    if (expect_value_) { expect_value_ = false; return; }
    if (!stack_.empty()) {
        if (stack_.back().has_item) out_ += ',';
        stack_.back().has_item = true;
    }
}

void Writer::begin_object() { maybe_comma(); out_ += '{'; stack_.push_back({ '}', false }); }
void Writer::end_object()   { out_ += '}'; stack_.pop_back(); }
void Writer::begin_array()  { maybe_comma(); out_ += '['; stack_.push_back({ ']', false }); }
void Writer::end_array()    { out_ += ']'; stack_.pop_back(); }

void Writer::key(std::string_view k) {
    maybe_comma();
    append_string(out_, k);
    out_ += ':';
    expect_value_ = true;
}

void Writer::value_string(std::string_view s)  { maybe_comma(); append_string(out_, s); }

void Writer::value_wstring(std::wstring_view w) {
    if (w.empty()) { maybe_comma(); out_ += "\"\""; return; }
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string utf8(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), utf8.data(), n, nullptr, nullptr);
    maybe_comma();
    append_string(out_, utf8);
}

void Writer::value_int(long long n)             { maybe_comma(); out_ += std::to_string(n); }
void Writer::value_uint(unsigned long long n)   { maybe_comma(); out_ += std::to_string(n); }

void Writer::value_double(double d) {
    maybe_comma();
    char buf[64];
    int n = std::snprintf(buf, sizeof(buf), "%.17g", d);
    if (n > 0) out_.append(buf, buf + n);
}

void Writer::value_bool(bool b)                 { maybe_comma(); out_ += b ? "true" : "false"; }
void Writer::value_null()                       { maybe_comma(); out_ += "null"; }
void Writer::value_raw(std::string_view raw)    { maybe_comma(); out_.append(raw); }

std::string unquote(std::string_view v) {
    if (v.size() < 2 || v.front() != '"' || v.back() != '"') return std::string(v);
    std::string out;
    out.reserve(v.size() - 2);
    for (size_t i = 1; i + 1 < v.size(); ++i) {
        char c = v[i];
        if (c == '\\' && i + 2 < v.size()) {
            char next = v[++i];
            switch (next) {
            case '"':  out += '"'; break;
            case '\\': out += '\\'; break;
            case '/':  out += '/'; break;
            case 'b':  out += '\b'; break;
            case 'f':  out += '\f'; break;
            case 'n':  out += '\n'; break;
            case 'r':  out += '\r'; break;
            case 't':  out += '\t'; break;
            case 'u': {
                if (i + 4 < v.size()) {
                    unsigned cp = 0;
                    for (int k = 0; k < 4; ++k) {
                        char h = v[++i];
                        cp <<= 4;
                        if (h >= '0' && h <= '9') cp |= (h - '0');
                        else if (h >= 'a' && h <= 'f') cp |= (h - 'a' + 10);
                        else if (h >= 'A' && h <= 'F') cp |= (h - 'A' + 10);
                    }
                    if (cp < 0x80) {
                        out += static_cast<char>(cp);
                    } else if (cp < 0x800) {
                        out += static_cast<char>(0xC0 | (cp >> 6));
                        out += static_cast<char>(0x80 | (cp & 0x3F));
                    } else {
                        out += static_cast<char>(0xE0 | (cp >> 12));
                        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                        out += static_cast<char>(0x80 | (cp & 0x3F));
                    }
                }
                break;
            }
            default: out += next;
            }
        } else {
            out += c;
        }
    }
    return out;
}

} // namespace stackr::json
