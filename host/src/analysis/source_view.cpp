#include "source_view.h"

#include <algorithm>
#include <fstream>
#include <unordered_map>

#include "../util/logging.h"

namespace stackr::analysis {

namespace {

bool read_lines(const std::string& path, uint32_t start, uint32_t end,
                std::vector<SourceLine>& out, std::string& err)
{
    std::ifstream f(path, std::ios::binary);
    if (!f) {
        err = "open failed";
        return false;
    }
    f.seekg(0, std::ios::end);
    auto size = f.tellg();
    if (size < 0) { err = "stat failed"; return false; }
    if (size > 64 * 1024 * 1024) { err = "file too large (> 64 MB)"; return false; }
    f.seekg(0, std::ios::beg);

    std::string line;
    uint32_t cur = 0;
    out.reserve(end - start + 1);
    while (std::getline(f, line)) {
        ++cur;
        if (cur > end) break;
        if (cur < start) continue;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        SourceLine sl;
        sl.line = cur;
        sl.code = std::move(line);
        out.push_back(std::move(sl));
    }
    return true;
}

} // namespace

SourceListing build_source_view(const std::vector<sampler::Sample>& samples,
                                symbols::Resolver& resolver,
                                uint32_t pid,
                                uint32_t tid_filter,
                                uint64_t function_module_base,
                                uint64_t function_addr_start,
                                uint32_t context_lines)
{
    SourceListing out;
    out.pid                  = pid;
    out.tid_filter           = tid_filter;
    out.function_addr        = function_addr_start;
    out.function_module_base = function_module_base;

    std::unordered_map<std::string, std::unordered_map<uint32_t, uint64_t>> hits;

    for (const auto& s : samples) {
        if (tid_filter != 0 && s.tid != tid_filter) continue;
        if (s.depth == 0) continue;

        uint64_t top_addr = s.frames[0];
        const auto& rf = resolver.resolve(top_addr);
        if (rf.module_base != function_module_base) continue;
        const uint64_t addr_start = rf.addr - rf.displacement;
        if (addr_start != function_addr_start) continue;

        if (out.function.empty()) {
            out.function = rf.function;
            out.module   = rf.module_name;
        }

        if (!rf.source_file.empty() && rf.source_line != 0) {
            ++hits[rf.source_file][rf.source_line];
            ++out.total_hits;
        } else {
            ++out.samples_no_line_info;
        }
    }

    if (out.function.empty()) {
        const auto& rf = resolver.resolve(function_addr_start);
        out.function = rf.function;
        out.module   = rf.module_name;
    }

    if (hits.empty()) {
        out.file_error = out.total_hits == 0
            ? "No samples hit this function in the current filter"
            : "PDB has no line information for the hit addresses";
        return out;
    }

    std::string best_file;
    uint64_t    best_total = 0;
    for (const auto& [file, lines_map] : hits) {
        uint64_t t = 0;
        for (const auto& [l, h] : lines_map) t += h;
        if (t > best_total) {
            best_total = t;
            best_file  = file;
        }
    }
    for (const auto& [file, lines_map] : hits) {
        if (file == best_file) continue;
        uint64_t t = 0;
        for (const auto& [l, h] : lines_map) t += h;
        out.other_files.push_back({file, t});
    }
    std::sort(out.other_files.begin(), out.other_files.end(),
              [](const SourceFileRef& a, const SourceFileRef& b) {
                  return a.hits > b.hits;
              });
    out.file = best_file;

    const auto& main_lines = hits.at(best_file);

    uint32_t min_line = UINT32_MAX;
    uint32_t max_line = 0;
    for (const auto& [l, h] : main_lines) {
        if (l < min_line) min_line = l;
        if (l > max_line) max_line = l;
    }
    out.start_line = (min_line > context_lines) ? min_line - context_lines : 1;
    out.end_line   = max_line + context_lines;

    std::vector<SourceLine> raw_lines;
    std::string err;
    if (!read_lines(best_file, out.start_line, out.end_line, raw_lines, err)) {
        out.file_available = false;
        out.file_error     = err.empty() ? "read failed" : err;
        logging::warn("source_view: cannot read {}: {}", best_file, out.file_error);
        return out;
    }

    out.file_available = true;
    for (auto& sl : raw_lines) {
        if (auto it = main_lines.find(sl.line); it != main_lines.end()) {
            sl.hits = it->second;
        }
        out.lines.push_back(std::move(sl));
    }
    if (!out.lines.empty()) {
        out.end_line = out.lines.back().line;   // EOF may have clipped us short
    }
    return out;
}

} // namespace stackr::analysis
