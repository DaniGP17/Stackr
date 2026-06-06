cmake_minimum_required(VERSION 3.25)
project(stackr
    VERSION 0.1.0
    DESCRIPTION "Modern sampling profiler for Windows x64"
    LANGUAGES CXX
)

if(NOT WIN32)
    message(FATAL_ERROR "Stackr targets Windows only.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Output everything to a single bin/ dir
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

# Force x64 only
if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(FATAL_ERROR "Stackr is x64-only. Re-run with `cmake -A x64`.")
endif()

# Static CRT so the .exe has zero MSVC runtime dependencies
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Common compile defines
add_compile_definitions(
    UNICODE _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    _CRT_SECURE_NO_WARNINGS
)

# Modern Windows target
add_compile_definitions(
    WINVER=0x0A00
    _WIN32_WINNT=0x0A00
)

if(MSVC)
    add_compile_options(/W4 /permissive- /Zc:__cplusplus /utf-8 /MP)
    # /Gw enables function-level linking, /Gy too — shrink the binary
    add_compile_options($<$<CONFIG:Release>:/O2> $<$<CONFIG:Release>:/GL> $<$<CONFIG:Release>:/Gy> $<$<CONFIG:Release>:/Gw>)
    add_link_options($<$<CONFIG:Release>:/LTCG> $<$<CONFIG:Release>:/OPT:REF> $<$<CONFIG:Release>:/OPT:ICF>)
endif()

# Where the Next.js static export lands after `pnpm build`
set(STACKR_WEB_OUT_DIR "${CMAKE_SOURCE_DIR}/web/out"
    CACHE PATH "Directory containing the Next.js static export"
)

# Dev mode: load http://localhost:3000 instead of embedded assets
option(STACKR_DEV_SERVER "Load WebView2 from http://localhost:3000 instead of embedded resources" OFF)
if(STACKR_DEV_SERVER)
    add_compile_definitions(STACKR_DEV_SERVER=1)
endif()

include(cmake/fetch_webview2.cmake)
include(cmake/fetch_capstone.cmake)

add_subdirectory(host)
