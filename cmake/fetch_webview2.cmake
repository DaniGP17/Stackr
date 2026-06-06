# Download the official Microsoft.Web.WebView2 NuGet package and expose it
# as an INTERFACE target. We use the static loader so the final .exe has
# no extra DLL dependency beyond the WebView2 runtime on the system.

include(FetchContent)

set(WEBVIEW2_VERSION "1.0.3967.48")

FetchContent_Declare(
    webview2
    URL "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WEBVIEW2_VERSION}/microsoft.web.webview2.${WEBVIEW2_VERSION}.nupkg"
    URL_HASH SHA256=c66357ac7f324ec9bcafe5241706a023b4122d8c22300c31de4b0eb220db689e
    DOWNLOAD_NO_PROGRESS FALSE
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)

FetchContent_GetProperties(webview2)
if(NOT webview2_POPULATED)
    message(STATUS "Fetching Microsoft.Web.WebView2 ${WEBVIEW2_VERSION}...")
    FetchContent_MakeAvailable(webview2)
endif()

add_library(webview2 INTERFACE)
target_include_directories(webview2 INTERFACE
    "${webview2_SOURCE_DIR}/build/native/include"
)
target_link_libraries(webview2 INTERFACE
    "${webview2_SOURCE_DIR}/build/native/x64/WebView2LoaderStatic.lib"
    version
)
add_library(stackr::webview2 ALIAS webview2)
