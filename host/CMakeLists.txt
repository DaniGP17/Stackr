add_executable(stackr WIN32
    src/main.cpp
    src/app.cpp
    src/webview/webview_host.cpp
    src/webview/virtual_host.cpp
    src/ipc/rpc_router.cpp
    src/process/enumerator.cpp
    src/process/launcher.cpp
    src/process/attacher.cpp
    src/process/registry.cpp
    src/process/methods.cpp
    src/sampler/stackwalk.cpp
    src/sampler/sampler.cpp
    src/sampler/methods.cpp
    src/symbols/search_path.cpp
    src/symbols/session.cpp
    src/symbols/resolver.cpp
    src/symbols/methods.cpp
    src/analysis/flat_profile.cpp
    src/analysis/call_tree.cpp
    src/analysis/source_view.cpp
    src/analysis/methods.cpp
    src/disasm/disassembler.cpp
    src/disasm/methods.cpp
    src/system/methods.cpp
    src/util/json.cpp
    src/util/logging.cpp
    resources/stackr.rc
)

target_include_directories(stackr PRIVATE
    src
    "${CMAKE_BINARY_DIR}/generated"
)

target_link_libraries(stackr PRIVATE
    stackr::webview2
    stackr::capstone
    Shcore       # SetProcessDpiAwarenessContext
    Shlwapi      # PathFindExtension etc.
    Dwmapi       # Dark titlebar
    Comctl32     # Modern controls
)

set_target_properties(stackr PROPERTIES
    OUTPUT_NAME "Stackr"
)

# We supply the manifest ourselves via stackr.rc — disable MSVC auto-manifest
# to avoid CVT1100 duplicate-resource errors.
if(MSVC)
    target_link_options(stackr PRIVATE "/MANIFEST:NO")
endif()

# ---------------------------------------------------------------------------
# Embed web/out as RT_RCDATA. We generate an .rc + index header at config
# time. Re-run CMake after `pnpm build` to refresh the embedded blob.
# ---------------------------------------------------------------------------
include("${CMAKE_SOURCE_DIR}/cmake/embed_web_assets.cmake")
stackr_embed_web_assets(
    TARGET     stackr
    SOURCE_DIR "${STACKR_WEB_OUT_DIR}"
    OUTPUT_DIR "${CMAKE_BINARY_DIR}/generated"
)
