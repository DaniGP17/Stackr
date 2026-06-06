#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "../sampler/types.h"
#include "../symbols/resolver.h"

namespace stackr::analysis {

struct SourceLine {
    uint32_t    line;
    uint64_t    hits;
    std::string code;
};

struct SourceFileRef {
    std::string file;
    uint64_t    hits;
};

struct SourceListing {
    uint32_t    pid                  = 0;
    uint32_t    tid_filter           = 0;
    uint64_t    function_addr        = 0;
    uint64_t    function_module_base = 0;
    std::string function;
    std::string module;

    std::string file;                       // primary file (most hits)
    bool        file_available           = false;
    std::string file_error;

    uint32_t    start_line               = 0;
    uint32_t    end_line                 = 0;
    uint64_t    total_hits               = 0;
    uint64_t    samples_no_line_info     = 0;

    std::vector<SourceLine>    lines;
    std::vector<SourceFileRef> other_files;
};

SourceListing build_source_view(const std::vector<sampler::Sample>& samples,
                                symbols::Resolver& resolver,
                                uint32_t pid,
                                uint32_t tid_filter,
                                uint64_t function_module_base,
                                uint64_t function_addr_start,
                                uint32_t context_lines = 10);

} // namespace stackr::analysis
