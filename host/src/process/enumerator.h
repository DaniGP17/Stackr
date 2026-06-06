#pragma once

#include <vector>

#include "types.h"

namespace stackr::process {

std::vector<ProcessInfo> enumerate(bool fill_paths);

} // namespace stackr::process
