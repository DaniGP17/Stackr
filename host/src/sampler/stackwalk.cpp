#include "stackwalk.h"

#include <dbghelp.h>

#include "../util/logging.h"

#pragma comment(lib, "Dbghelp.lib")

namespace stackr::sampler {

uint16_t walk(HANDLE proc, HANDLE thread, const CONTEXT& ctx_in,
              uint64_t* out_frames, uint16_t max_depth, bool& truncated)
{
    truncated = false;
    if (!proc || !thread || max_depth == 0) return 0;

    CONTEXT ctx = ctx_in;

    STACKFRAME64 sf{};
    sf.AddrPC.Offset    = ctx.Rip;
    sf.AddrPC.Mode      = AddrModeFlat;
    sf.AddrFrame.Offset = ctx.Rbp;
    sf.AddrFrame.Mode   = AddrModeFlat;
    sf.AddrStack.Offset = ctx.Rsp;
    sf.AddrStack.Mode   = AddrModeFlat;

    uint16_t depth = 0;
    while (depth < max_depth) {
        BOOL ok = StackWalk64(
            IMAGE_FILE_MACHINE_AMD64,
            proc, thread,
            &sf, &ctx,
            nullptr, // ReadMemoryRoutine: default uses ReadProcessMemory
            SymFunctionTableAccess64,
            SymGetModuleBase64,
            nullptr);

        if (!ok) break;
        if (sf.AddrPC.Offset == 0) break;

        out_frames[depth++] = sf.AddrPC.Offset;
    }

    if (depth == max_depth) truncated = true;
    return depth;
}

} // namespace stackr::sampler
