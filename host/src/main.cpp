#include <windows.h>
#include <shellscalingapi.h>
#include <objbase.h>

#include "app.h"
#include "util/logging.h"

int APIENTRY wWinMain(
    _In_ HINSTANCE hInstance,
    _In_opt_ HINSTANCE,
    _In_ LPWSTR lpCmdLine,
    _In_ int nShowCmd)
{
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    // CoInitialize must precede WebView2 creation on this thread.
    HRESULT co = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    if (FAILED(co)) {
        MessageBoxW(nullptr, L"CoInitializeEx failed.", L"Stackr", MB_ICONERROR | MB_OK);
        return 1;
    }

    stackr::logging::init();
    int rc;
    {
        stackr::App app{hInstance, lpCmdLine, nShowCmd};
        rc = app.run();
    }
    CoUninitialize();
    return rc;
}
