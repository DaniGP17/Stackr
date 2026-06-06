# Vendor the Capstone x86 disassembler for the in-process function viewer.
# We disable every architecture except x86 so the static .lib stays small
# (~300 KB instead of ~2 MB with all arches enabled).

include(FetchContent)

set(CAPSTONE_VERSION "5.0.6")

set(CAPSTONE_ARCHITECTURE_DEFAULT OFF CACHE BOOL "" FORCE)
set(CAPSTONE_X86_SUPPORT          ON  CACHE BOOL "" FORCE)
set(CAPSTONE_ARM_SUPPORT          OFF CACHE BOOL "" FORCE)
set(CAPSTONE_ARM64_SUPPORT        OFF CACHE BOOL "" FORCE)
set(CAPSTONE_M68K_SUPPORT         OFF CACHE BOOL "" FORCE)
set(CAPSTONE_MIPS_SUPPORT         OFF CACHE BOOL "" FORCE)
set(CAPSTONE_PPC_SUPPORT          OFF CACHE BOOL "" FORCE)
set(CAPSTONE_SPARC_SUPPORT        OFF CACHE BOOL "" FORCE)
set(CAPSTONE_SYSZ_SUPPORT         OFF CACHE BOOL "" FORCE)
set(CAPSTONE_XCORE_SUPPORT        OFF CACHE BOOL "" FORCE)
set(CAPSTONE_TMS320C64X_SUPPORT   OFF CACHE BOOL "" FORCE)
set(CAPSTONE_M680X_SUPPORT        OFF CACHE BOOL "" FORCE)
set(CAPSTONE_EVM_SUPPORT          OFF CACHE BOOL "" FORCE)
set(CAPSTONE_WASM_SUPPORT         OFF CACHE BOOL "" FORCE)
set(CAPSTONE_MOS65XX_SUPPORT      OFF CACHE BOOL "" FORCE)
set(CAPSTONE_BPF_SUPPORT          OFF CACHE BOOL "" FORCE)
set(CAPSTONE_RISCV_SUPPORT        OFF CACHE BOOL "" FORCE)
set(CAPSTONE_SH_SUPPORT           OFF CACHE BOOL "" FORCE)
set(CAPSTONE_TRICORE_SUPPORT      OFF CACHE BOOL "" FORCE)
set(CAPSTONE_ALPHA_SUPPORT        OFF CACHE BOOL "" FORCE)
set(CAPSTONE_HPPA_SUPPORT         OFF CACHE BOOL "" FORCE)
set(CAPSTONE_LOONGARCH_SUPPORT    OFF CACHE BOOL "" FORCE)
set(CAPSTONE_XTENSA_SUPPORT       OFF CACHE BOOL "" FORCE)
set(CAPSTONE_BUILD_TESTS          OFF CACHE BOOL "" FORCE)
set(CAPSTONE_BUILD_CSTEST         OFF CACHE BOOL "" FORCE)
set(CAPSTONE_BUILD_CSTOOL         OFF CACHE BOOL "" FORCE)
set(CAPSTONE_BUILD_SHARED_LIBS    OFF CACHE BOOL "" FORCE)
set(CAPSTONE_INSTALL              OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    capstone
    URL "https://github.com/capstone-engine/capstone/archive/refs/tags/${CAPSTONE_VERSION}.tar.gz"
    URL_HASH SHA256=240ebc834c51aae41ca9215d3190cc372fd132b9c5c8aa2d5f19ca0c325e28f9
    DOWNLOAD_NO_PROGRESS FALSE
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)

FetchContent_GetProperties(capstone)
if(NOT capstone_POPULATED)
    message(STATUS "Fetching Capstone ${CAPSTONE_VERSION} (x86 only)...")
    FetchContent_MakeAvailable(capstone)
endif()

add_library(stackr_capstone INTERFACE)
# Capstone 5.x exposes `capstone` as an OBJECT library and `capstone_static`
# as the actual STATIC target with the public archive.
target_link_libraries(stackr_capstone INTERFACE capstone_static)
target_include_directories(stackr_capstone INTERFACE
    "${capstone_SOURCE_DIR}/include"
)
add_library(stackr::capstone ALIAS stackr_capstone)
