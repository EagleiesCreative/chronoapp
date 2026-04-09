/*
 * Sony Camera Remote SDK — C Bridge Implementation
 *
 * Wraps the C++ Sony CrSDK API in an extern "C" interface for FFI.
 * All C++ exceptions are caught and converted to error codes.
 *
 * NOTE: This file is compiled against the Sony CrSDK headers + libCr_Core.dylib.
 *       If the SDK is not present, compilation will fail — this is intentional.
 *       The Rust side (sony.rs) uses runtime dynamic loading so the app still
 *       works without the Sony SDK installed; only Sony features are disabled.
 */

#include "sony_bridge.h"

/* ---- Sony CrSDK headers ---- */
/* These come from the downloaded CrSDK package in libs/CrSDK/include/ */
#include "CameraRemote_SDK.h"
#include "IDeviceCallback.h"

#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <cstdarg>
#include <mutex>
#include <condition_variable>
#include <vector>
#include <atomic>
#include <thread>
#include <chrono>

/* ============================================================
 * Thread-local error message
 * ============================================================ */
static thread_local char s_last_error[512] = {0};

static void set_error(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    vsnprintf(s_last_error, sizeof(s_last_error), fmt, args);
    va_end(args);
}

/* ============================================================
 * Device callback — receives events from the CrSDK
 * ============================================================ */
using namespace SCRSDK;

class BridgeDeviceCallback : public IDeviceCallback {
public:
    std::mutex mtx;
    std::condition_variable cv;

    /* Connection state */
    std::atomic<bool> connected{false};

    /* Capture state */
    std::atomic<bool> capture_complete{false};
    std::string download_filename;
    std::mutex capture_mtx;

    /* PostView image (RAM transfer) */
    std::atomic<bool> postview_ready{false};
    std::atomic<uint32_t> postview_size{0};

    void OnConnected(DeviceConnectionVersioin version) override {
        (void)version;
        connected = true;
        cv.notify_all();
    }

    void OnDisconnected(CrInt32u reason) override {
        (void)reason;
        connected = false;
        cv.notify_all();
    }

    void OnPropertyChanged() override { }
    void OnPropertyChangedCodes(CrInt32u num, CrInt32u* codes) override {
        (void)num; (void)codes;
    }
    void OnLvPropertyChanged() override { }
    void OnLvPropertyChangedCodes(CrInt32u num, CrInt32u* codes) override {
        (void)num; (void)codes;
    }

    void OnCompleteDownload(CrChar* filename, CrInt32u type) override {
        (void)type;
        {
            std::lock_guard<std::mutex> lock(capture_mtx);
            if (filename) {
                /* On macOS, CrChar is `char` (non-Unicode build) */
                download_filename = std::string(filename);
            }
        }
        capture_complete = true;
        cv.notify_all();
    }

    void OnCompleteOperation(CrInt32u code, CrOperationResultData* resultData) override {
        (void)code; (void)resultData;
    }

    void OnNotifyContentsTransfer(CrInt32u notify, CrContentHandle handle, CrChar* filename) override {
        (void)notify; (void)handle; (void)filename;
    }

    void OnWarning(CrInt32u warning) override { (void)warning; }
    void OnWarningExt(CrInt32u warning, CrInt32 param1, CrInt32 param2, CrInt32 param3) override {
        (void)warning; (void)param1; (void)param2; (void)param3;
    }
    void OnError(CrInt32u error) override { (void)error; }

    void OnNotifyFTPTransferResult(CrInt32u notify, CrInt32u numOfSuccess, CrInt32u numOfFail) override {
        (void)notify; (void)numOfSuccess; (void)numOfFail;
    }
    void OnNotifyRemoteTransferResult(CrInt32u notify, CrInt32u per, CrChar* filename) override {
        (void)notify; (void)per; (void)filename;
    }
    void OnNotifyRemoteTransferResult(CrInt32u notify, CrInt32u per, CrInt8u* data, CrInt64u size) override {
        (void)notify; (void)per; (void)data; (void)size;
    }
    void OnNotifyRemoteTransferContentsListChanged(CrInt32u notify, CrInt32u slotNumber, CrInt32u addSize) override {
        (void)notify; (void)slotNumber; (void)addSize;
    }
    void OnNotifyRemoteFirmwareUpdateResult(CrInt32u notify, const void* param) override {
        (void)notify; (void)param;
    }
    void OnReceivePlaybackTimeCode(CrInt32u timeCode) override { (void)timeCode; }
    void OnReceivePlaybackData(CrInt8u mediaType, CrInt32 dataSize, CrInt8u* data, CrInt64 pts, CrInt64 dts, CrInt32 param1, CrInt32 param2) override {
        (void)mediaType; (void)dataSize; (void)data; (void)pts; (void)dts; (void)param1; (void)param2;
    }
    void OnNotifyMonitorUpdated(CrInt32u type, CrInt32u frameNo) override {
        (void)type; (void)frameNo;
    }
    void OnNotifyPostViewImage(CrChar* filename, CrInt32u size) override {
        postview_size = size;
        postview_ready = true;
        cv.notify_all();
    }
};

/* ============================================================
 * Internal state
 * ============================================================ */

struct SonyDevice {
    CrDeviceHandle handle;
    BridgeDeviceCallback* callback;
    int camera_index;
};

static std::atomic<bool> s_sdk_initialized{false};
static std::mutex s_global_mtx;

/* Cached enumeration — we keep the enumerator alive to reference camera objects */
static ICrEnumCameraObjectInfo* s_enum_info = nullptr;

/* ============================================================
 * SDK Lifecycle
 * ============================================================ */

extern "C" int sony_sdk_init(void) {
    std::lock_guard<std::mutex> lock(s_global_mtx);
    if (s_sdk_initialized) return SONY_OK;

    try {
        bool ok = SCRSDK::Init(0); /* 0 = no log output */
        if (!ok) {
            set_error("CrSDK Init returned false");
            return SONY_ERR_INIT;
        }
        s_sdk_initialized = true;
        return SONY_OK;
    } catch (const std::exception& e) {
        set_error("CrSDK Init exception: %s", e.what());
        return SONY_ERR_INIT;
    } catch (...) {
        set_error("CrSDK Init unknown exception");
        return SONY_ERR_INIT;
    }
}

extern "C" void sony_sdk_release(void) {
    std::lock_guard<std::mutex> lock(s_global_mtx);
    if (!s_sdk_initialized) return;

    try {
        /* Release cached enumerator */
        if (s_enum_info) {
            s_enum_info->Release();
            s_enum_info = nullptr;
        }

        SCRSDK::Release();
        s_sdk_initialized = false;
    } catch (...) { }
}

/* ============================================================
 * Camera Discovery
 * ============================================================ */

extern "C" int sony_enum_cameras(SonyCameraInfo* cameras, int max_count) {
    if (!s_sdk_initialized) {
        set_error("SDK not initialized");
        return SONY_ERR_INIT;
    }

    try {
        /* Release previous enumeration */
        if (s_enum_info) {
            s_enum_info->Release();
            s_enum_info = nullptr;
        }

        CrError result = SCRSDK::EnumCameraObjects(&s_enum_info, 3 /* timeout sec */);
        if (result != CrError_None || !s_enum_info) {
            set_error("EnumCameraObjects failed: 0x%08X", (unsigned)result);
            return SONY_ERR_ENUM;
        }

        int count = (int)s_enum_info->GetCount();
        int returned = 0;

        for (int i = 0; i < count && i < max_count; i++) {
            const auto* info = s_enum_info->GetCameraObjectInfo(i);
            if (!info) continue;

            cameras[returned].index = i;
            cameras[returned].connection_type = info->GetIdType();

            /* Get camera name / model */
            auto name = info->GetName();
            if (name) {
                snprintf(cameras[returned].name, SONY_MAX_CAMERA_NAME, "%s", name);
            } else {
                snprintf(cameras[returned].name, SONY_MAX_CAMERA_NAME, "Sony Camera %d", i);
            }

            auto model = info->GetModel();
            if (model) {
                snprintf(cameras[returned].model, SONY_MAX_CAMERA_NAME, "%s", model);
            } else {
                strncpy(cameras[returned].model, cameras[returned].name, SONY_MAX_CAMERA_NAME);
            }

            returned++;
        }

        return returned;
    } catch (const std::exception& e) {
        set_error("EnumCameras exception: %s", e.what());
        return SONY_ERR_ENUM;
    } catch (...) {
        set_error("EnumCameras unknown exception");
        return SONY_ERR_ENUM;
    }
}

/* ============================================================
 * Connection
 * ============================================================ */

extern "C" SonyDeviceHandle sony_connect(int camera_index) {
    if (!s_sdk_initialized) {
        set_error("SDK not initialized");
        return nullptr;
    }

    if (!s_enum_info || camera_index < 0 || camera_index >= (int)s_enum_info->GetCount()) {
        set_error("Camera index %d out of range", camera_index);
        return nullptr;
    }

    try {
        auto* device = new SonyDevice();
        device->callback = new BridgeDeviceCallback();
        device->camera_index = camera_index;

        const auto* cam_info = s_enum_info->GetCameraObjectInfo(camera_index);

        /* Connect directly — the CrSDK Connect() creates the device session */
        CrError result = SCRSDK::Connect(
            const_cast<ICrCameraObjectInfo*>(cam_info),
            device->callback,
            &device->handle,
            CrSdkControlMode_Remote,    /* Remote control mode */
            CrReconnecting_ON            /* Auto-reconnect */
        );

        if (result != CrError_None) {
            set_error("Connect failed: 0x%08X", (unsigned)result);
            delete device->callback;
            delete device;
            return nullptr;
        }

        /* Wait for connection callback (up to 10 seconds) */
        {
            std::unique_lock<std::mutex> lock(device->callback->mtx);
            bool ok = device->callback->cv.wait_for(
                lock,
                std::chrono::seconds(10),
                [&]{ return device->callback->connected.load(); }
            );
            if (!ok) {
                set_error("Connection timeout");
                SCRSDK::Disconnect(device->handle);
                SCRSDK::ReleaseDevice(device->handle);
                delete device->callback;
                delete device;
                return nullptr;
            }
        }

        return (SonyDeviceHandle)device;
    } catch (const std::exception& e) {
        set_error("Connect exception: %s", e.what());
        return nullptr;
    } catch (...) {
        set_error("Connect unknown exception");
        return nullptr;
    }
}

extern "C" void sony_disconnect(SonyDeviceHandle handle) {
    if (!handle) return;
    auto* device = (SonyDevice*)handle;

    try {
        SCRSDK::Disconnect(device->handle);
        SCRSDK::ReleaseDevice(device->handle);
    } catch (...) { }

    delete device->callback;
    delete device;
}

extern "C" int sony_is_connected(SonyDeviceHandle handle) {
    if (!handle) return 0;
    auto* device = (SonyDevice*)handle;
    return device->callback->connected.load() ? 1 : 0;
}

/* ============================================================
 * Still Image Capture
 * ============================================================ */

extern "C" int sony_capture_still(SonyDeviceHandle handle,
                                  uint8_t** image_data,
                                  size_t* image_len)
{
    if (!handle || !image_data || !image_len) {
        set_error("Invalid parameters");
        return SONY_ERR_CAPTURE;
    }

    auto* device = (SonyDevice*)handle;
    if (!device->callback->connected) {
        set_error("Camera not connected");
        return SONY_ERR_CONNECT;
    }

    try {
        /* Reset capture state */
        device->callback->capture_complete = false;
        device->callback->postview_ready = false;

        /* Configure: enable post-view transfer to RAM */
        {
            CrInt32u settingKey = Setting_Key_EnablePostView;
            CrInt32u settingValue = 1;
            SCRSDK::SetDeviceSetting(device->handle, settingKey, settingValue);
        }
        {
            CrInt32u settingKey = Setting_Key_PostViewTransferringType;
            CrInt32u settingValue = (CrInt32u)CrPostViewTransferring_UserSelect_RAM;
            SCRSDK::SetDeviceSetting(device->handle, settingKey, settingValue);
        }

        /* Shutter: half-press (AF engage) */
        CrError result = SCRSDK::SendCommand(
            device->handle,
            CrCommandId_S1andRelease,
            CrCommandParam_Down
        );
        if (result != CrError_None) {
            set_error("Shutter S1+Release Down failed: 0x%08X", (unsigned)result);
            return SONY_ERR_CAPTURE;
        }

        /* Small delay for AF to lock */
        std::this_thread::sleep_for(std::chrono::milliseconds(300));

        /* Full-release shutter */
        result = SCRSDK::SendCommand(
            device->handle,
            CrCommandId_S1andRelease,
            CrCommandParam_Up
        );
        if (result != CrError_None) {
            set_error("Shutter S1+Release Up failed: 0x%08X", (unsigned)result);
            return SONY_ERR_CAPTURE;
        }

        /* Wait for PostView callback (up to 15 seconds) */
        {
            std::unique_lock<std::mutex> lock(device->callback->mtx);
            bool ok = device->callback->cv.wait_for(
                lock,
                std::chrono::seconds(15),
                [&]{
                    return device->callback->postview_ready.load() ||
                           device->callback->capture_complete.load();
                }
            );
            if (!ok) {
                set_error("Capture timeout — image transfer took too long");
                return SONY_ERR_TIMEOUT;
            }
        }

        /* If PostView image is ready via RAM, pull it */
        if (device->callback->postview_ready.load()) {
            CrInt32u pvSize = device->callback->postview_size.load();
            if (pvSize > 0) {
                uint8_t* buf = (uint8_t*)malloc(pvSize);
                if (!buf) {
                    set_error("Failed to allocate PostView buffer (%u bytes)", pvSize);
                    return SONY_ERR_UNKNOWN;
                }

                CrError pvResult = SCRSDK::PullPostViewImage(
                    device->handle, buf, pvSize
                );
                if (pvResult == CrError_None) {
                    *image_data = buf;
                    *image_len = pvSize;
                    return SONY_OK;
                } else {
                    free(buf);
                    set_error("PullPostViewImage failed: 0x%08X", (unsigned)pvResult);
                    /* Fall through to try live view frame as fallback */
                }
            }
        }

        /* Fallback: grab a live view frame if PostView didn't work */
        {
            CrImageDataBlock lvBlock;
            const size_t BUF_SIZE = 1920 * 1080 * 3;
            uint8_t* lvBuf = (uint8_t*)malloc(BUF_SIZE);
            if (!lvBuf) {
                set_error("Failed to allocate live view buffer");
                return SONY_ERR_UNKNOWN;
            }
            lvBlock.SetSize((CrInt32u)BUF_SIZE);
            lvBlock.SetData(lvBuf);

            CrError lvResult = SCRSDK::GetLiveViewImage(device->handle, &lvBlock);
            if (lvResult == CrError_None && lvBlock.GetImageSize() > 0) {
                *image_len = lvBlock.GetImageSize();
                *image_data = (uint8_t*)malloc(*image_len);
                if (*image_data) {
                    memcpy(*image_data, lvBlock.GetImageData(), *image_len);
                    free(lvBuf);
                    return SONY_OK;
                }
            }
            free(lvBuf);
        }

        set_error("Capture completed but no image data available");
        return SONY_ERR_CAPTURE;
    } catch (const std::exception& e) {
        set_error("Capture exception: %s", e.what());
        return SONY_ERR_CAPTURE;
    } catch (...) {
        set_error("Capture unknown exception");
        return SONY_ERR_CAPTURE;
    }
}

extern "C" void sony_free_image(uint8_t* image_data) {
    free(image_data);
}

/* ============================================================
 * Live View
 * ============================================================ */

extern "C" int sony_start_live_view(SonyDeviceHandle handle) {
    if (!handle) return SONY_ERR_LIVEVIEW;
    auto* device = (SonyDevice*)handle;

    try {
        /* Enable live view via the device setting API */
        CrInt32u key = Setting_Key_EnableLiveView;
        CrInt32u value = CrDeviceSetting_Enable;
        CrError result = SCRSDK::SetDeviceSetting(device->handle, key, value);
        if (result != CrError_None) {
            set_error("Start live view failed: 0x%08X", (unsigned)result);
            return SONY_ERR_LIVEVIEW;
        }
        return SONY_OK;
    } catch (const std::exception& e) {
        set_error("Start live view exception: %s", e.what());
        return SONY_ERR_LIVEVIEW;
    } catch (...) {
        return SONY_ERR_LIVEVIEW;
    }
}

extern "C" int sony_get_live_view_frame(SonyDeviceHandle handle,
                                        uint8_t** frame_data,
                                        size_t* frame_len)
{
    if (!handle || !frame_data || !frame_len) return SONY_ERR_LIVEVIEW;
    auto* device = (SonyDevice*)handle;

    try {
        /* Allocate a buffer for the live view image.
         * CrSDK live view is typically JPEG, ~200KB-1MB range.
         * We allocate a generous buffer. */
        const size_t BUF_SIZE = 2 * 1024 * 1024; /* 2MB */
        uint8_t* buf = (uint8_t*)malloc(BUF_SIZE);
        if (!buf) return SONY_ERR_UNKNOWN;

        CrImageDataBlock imageBlock;
        imageBlock.SetSize((CrInt32u)BUF_SIZE);
        imageBlock.SetData(buf);

        CrError result = SCRSDK::GetLiveViewImage(device->handle, &imageBlock);
        if (result != CrError_None || imageBlock.GetImageSize() == 0) {
            free(buf);
            return SONY_ERR_NOT_READY;
        }

        /* Copy just the actual image data to a right-sized buffer */
        CrInt32u imgSize = imageBlock.GetImageSize();
        *frame_data = (uint8_t*)malloc(imgSize);
        if (!*frame_data) {
            free(buf);
            return SONY_ERR_UNKNOWN;
        }
        memcpy(*frame_data, imageBlock.GetImageData(), imgSize);
        *frame_len = imgSize;

        free(buf);
        return SONY_OK;
    } catch (...) {
        return SONY_ERR_LIVEVIEW;
    }
}

extern "C" int sony_stop_live_view(SonyDeviceHandle handle) {
    if (!handle) return SONY_ERR_LIVEVIEW;
    auto* device = (SonyDevice*)handle;

    try {
        CrInt32u key = Setting_Key_EnableLiveView;
        CrInt32u value = CrDeviceSetting_Disable;
        CrError result = SCRSDK::SetDeviceSetting(device->handle, key, value);
        if (result != CrError_None) {
            set_error("Stop live view failed: 0x%08X", (unsigned)result);
            return SONY_ERR_LIVEVIEW;
        }
        return SONY_OK;
    } catch (...) {
        return SONY_ERR_LIVEVIEW;
    }
}

/* ============================================================
 * Device Properties
 * ============================================================ */

extern "C" int sony_set_property(SonyDeviceHandle handle,
                                 uint32_t property_id,
                                 uint64_t value)
{
    if (!handle) return SONY_ERR_PROPERTY;
    auto* device = (SonyDevice*)handle;

    try {
        /* Build a CrDeviceProperty struct to pass to SetDeviceProperty */
        CrDeviceProperty prop;
        memset(&prop, 0, sizeof(prop));
        /* The SDK's SetDeviceProperty takes a CrDeviceProperty pointer */
        prop.SetCode((CrInt32u)property_id);
        prop.SetCurrentValue((CrInt64u)value);
        prop.SetValueType(CrDataType_UInt32);

        CrError result = SCRSDK::SetDeviceProperty(device->handle, &prop);
        if (result != CrError_None) {
            set_error("SetProperty 0x%08X failed: 0x%08X", property_id, (unsigned)result);
            return SONY_ERR_PROPERTY;
        }
        return SONY_OK;
    } catch (...) {
        return SONY_ERR_PROPERTY;
    }
}

extern "C" int sony_get_property(SonyDeviceHandle handle,
                                 uint32_t property_id,
                                 uint64_t* value)
{
    if (!handle || !value) return SONY_ERR_PROPERTY;
    auto* device = (SonyDevice*)handle;

    try {
        CrDeviceProperty* props = nullptr;
        CrInt32 numProps = 0;
        CrInt32u code = (CrInt32u)property_id;

        CrError result = SCRSDK::GetSelectDeviceProperties(
            device->handle, 1, &code, &props, &numProps
        );
        if (result != CrError_None || numProps == 0 || !props) {
            set_error("GetProperty 0x%08X failed: 0x%08X", property_id, (unsigned)result);
            return SONY_ERR_PROPERTY;
        }

        *value = (uint64_t)props[0].GetCurrentValue();
        SCRSDK::ReleaseDeviceProperties(device->handle, props);
        return SONY_OK;
    } catch (...) {
        return SONY_ERR_PROPERTY;
    }
}

/* ============================================================
 * Utility
 * ============================================================ */

extern "C" void sony_kill_ptpcamera(void) {
#if defined(__APPLE__)
    /* Kill the macOS PTPCamera process that blocks USB access to the camera */
    system("killall PTPCamera 2>/dev/null");
    /* Brief delay to let the process exit */
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
#endif
}

extern "C" const char* sony_get_last_error(void) {
    return s_last_error;
}
