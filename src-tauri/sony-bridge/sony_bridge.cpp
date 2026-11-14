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
#include <cctype>
#include <cerrno>
#include <algorithm>
#include <string>
#include <mutex>
#include <condition_variable>
#include <vector>
#include <atomic>
#include <thread>
#include <chrono>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

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
 * File & JPEG Helpers
 * ============================================================ */

static bool is_valid_jpeg(const uint8_t* data, size_t len) {
    return data && len >= 128 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF;
}

static bool ends_with_jpeg_ci(const std::string& path) {
    size_t dot = path.find_last_of('.');
    if (dot == std::string::npos) return false;
    std::string ext = path.substr(dot);
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return (char)std::tolower(c); });
    return ext == ".jpg" || ext == ".jpeg";
}

static std::string resolve_download_path(const std::string& dir, const char* filename) {
    if (!filename || filename[0] == '\0') return std::string();
    if (filename[0] == '/' || dir.empty()) return std::string(filename);
    if (dir.back() == '/') return dir + filename;
    return dir + "/" + filename;
}

static bool read_valid_jpeg_file(const std::string& path, uint8_t** out_data, size_t* out_len) {
    if (path.empty() || !out_data || !out_len) return false;

    FILE* fp = fopen(path.c_str(), "rb");
    if (!fp) return false;

    if (fseek(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        return false;
    }
    long file_size = ftell(fp);
    if (file_size < 128 || file_size > 100L * 1024L * 1024L) {
        fclose(fp);
        return false;
    }
    rewind(fp);

    uint8_t* buf = (uint8_t*)malloc((size_t)file_size);
    if (!buf) {
        fclose(fp);
        return false;
    }

    size_t total_read = 0;
    while (total_read < (size_t)file_size) {
        size_t n = fread(buf + total_read, 1, (size_t)file_size - total_read, fp);
        if (n == 0) break;
        total_read += n;
    }
    fclose(fp);

    if (total_read != (size_t)file_size || !is_valid_jpeg(buf, total_read)) {
        free(buf);
        return false;
    }

    *out_data = buf;
    *out_len = total_read;
    return true;
}

static void clear_dir_files(const std::string& dir, bool remove_dir) {
    if (dir.empty()) return;
    DIR* d = opendir(dir.c_str());
    if (!d) return;

    struct dirent* entry;
    while ((entry = readdir(d)) != nullptr) {
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
        std::string full = dir + "/" + entry->d_name;
        unlink(full.c_str());
    }
    closedir(d);

    if (remove_dir) {
        rmdir(dir.c_str());
    }
}

/* ============================================================
 * Device callback — receives events from the CrSDK
 * ============================================================ */
using namespace SCRSDK;

class BridgeDeviceCallback : public IDeviceCallback {
public:
    std::mutex mtx;
    std::condition_variable cv;

    std::string save_dir;

    /* Connection state */
    std::atomic<bool> connected{false};

    /* Capture state (all guarded consistently by mtx) */
    std::atomic<bool> capturing_active{false};
    std::atomic<bool> exposure_started{false};
    std::atomic<bool> capture_complete{false};
    std::atomic<bool> all_download_complete{false};
    std::vector<std::string> download_filenames;

    /* PostView image (file or RAM transfer) */
    std::atomic<bool> postview_ready{false};
    std::atomic<bool> postview_ng{false};
    std::atomic<uint32_t> postview_size{0};
    std::string postview_filename;

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
        std::string resolved = resolve_download_path(save_dir, filename);
        std::lock_guard<std::mutex> lock(mtx);
        if (!capturing_active.load()) {
            /* Late or background file delivery after a shot already completed */
            fprintf(stderr, "[SonyBridge] Ignoring late OnCompleteDownload (%s)\n",
                    resolved.c_str());
            if (!resolved.empty()) {
                unlink(resolved.c_str());
            }
            return;
        }
        fprintf(stderr, "[SonyBridge] OnCompleteDownload: %s (type=0x%X)\n",
                resolved.c_str(), (unsigned)type);
        if (!resolved.empty()) {
            download_filenames.push_back(resolved);
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

    void OnWarning(CrInt32u warning) override {
        if (warning == CrNotify_Captured_Event) {
            std::lock_guard<std::mutex> lock(mtx);
            if (capturing_active.load()) {
                fprintf(stderr, "[SonyBridge] CrNotify_Captured_Event\n");
                exposure_started = true;
                cv.notify_all();
            }
        } else if (warning == CrNotify_All_Download_Complete) {
            std::lock_guard<std::mutex> lock(mtx);
            all_download_complete = true;
            cv.notify_all();
        } else if (warning == CrWarning_SetPostViewEnable_Result_NG) {
            postview_ng = true;
        } else if (warning == CrWarning_GetImage_Failed ||
                   warning == CrWarning_SetFileName_Failed) {
            fprintf(stderr, "[SonyBridge] OnWarning: 0x%08X\n", (unsigned)warning);
        }
    }
    void OnWarningExt(CrInt32u warning, CrInt32 param1, CrInt32 param2, CrInt32 param3) override {
        (void)warning; (void)param1; (void)param2; (void)param3;
    }
    void OnError(CrInt32u error) override {
        fprintf(stderr, "[SonyBridge] OnError: 0x%08X\n", (unsigned)error);
    }

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
        std::string resolved = resolve_download_path(save_dir, filename);
        std::lock_guard<std::mutex> lock(mtx);
        if (!capturing_active.load()) {
            if (!resolved.empty() && filename && filename[0]) {
                unlink(resolved.c_str());
            }
            return;
        }
        fprintf(stderr, "[SonyBridge] OnNotifyPostViewImage: size=%u file=%s\n",
                (unsigned)size, resolved.c_str());
        if (!resolved.empty()) {
            postview_filename = resolved;
        }
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
    std::string save_dir;
};

static std::atomic<bool> s_sdk_initialized{false};
static std::atomic<uint64_t> s_session_seq{0};
static std::mutex s_global_mtx;

/* Helper to update a writable device property while matching its native CrDataType */
static void try_set_device_property(CrDeviceHandle handle, CrInt32u code, CrInt64u value) {
    CrDeviceProperty* props = nullptr;
    CrInt32 numProps = 0;
    CrInt32u propCode = code;
    if (SCRSDK::GetSelectDeviceProperties(handle, 1, &propCode, &props, &numProps) == CrError_None) {
        if (props && numProps > 0) {
            if (props[0].IsSetEnableCurrentValue() && props[0].GetCurrentValue() != value) {
                CrDeviceProperty prop = props[0];
                prop.SetCurrentValue(value);
                CrError err = SCRSDK::SetDeviceProperty(handle, &prop);
                fprintf(stderr, "[SonyBridge] SetDeviceProperty(0x%X -> %llu) => 0x%08X\n",
                        (unsigned)code, (unsigned long long)value, (unsigned)err);
            }
        }
        if (props) {
            SCRSDK::ReleaseDeviceProperties(handle, props);
        }
    }
}

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
        uint64_t seq = ++s_session_seq;
        char dir_buf[256];
        snprintf(dir_buf, sizeof(dir_buf), "/tmp/chronosnap_sony_%d_%llu",
                 (int)getpid(), (unsigned long long)seq);
        if (mkdir(dir_buf, 0755) != 0 && errno != EEXIST) {
            fprintf(stderr, "[SonyBridge] Failed to create save_dir %s: errno=%d\n",
                    dir_buf, errno);
        }

        auto* device = new SonyDevice();
        device->callback = new BridgeDeviceCallback();
        device->camera_index = camera_index;
        device->save_dir = std::string(dir_buf);
        device->callback->save_dir = device->save_dir;

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
            clear_dir_files(device->save_dir, true);
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
                clear_dir_files(device->save_dir, true);
                delete device->callback;
                delete device;
                return nullptr;
            }
        }

        /* Configure save directory so CrSDK downloads captured JPEGs cleanly */
        char save_path[256];
        char save_prefix[] = "CS_";
        snprintf(save_path, sizeof(save_path), "%s", device->save_dir.c_str());
        CrError saveErr = SCRSDK::SetSaveInfo(
            device->handle,
            save_path,
            save_prefix,
            CrSETSAVEINFO_AUTO_NUMBER
        );
        fprintf(stderr, "[SonyBridge] SetSaveInfo(%s) => 0x%08X\n",
                save_path, (unsigned)saveErr);

        /* Allow PC remote shutter control and ensure host receives still captures */
        try_set_device_property(
            device->handle,
            CrDeviceProperty_PriorityKeySettings,
            CrPriorityKey_PCRemote
        );
        {
            CrDeviceProperty* props = nullptr;
            CrInt32 numProps = 0;
            CrInt32u propCode = CrDeviceProperty_StillImageStoreDestination;
            if (SCRSDK::GetSelectDeviceProperties(device->handle, 1, &propCode, &props, &numProps) == CrError_None) {
                if (props && numProps > 0) {
                    CrInt64u dest = props[0].GetCurrentValue();
                    fprintf(stderr, "[SonyBridge] StillImageStoreDestination=%llu writable=%d\n",
                            (unsigned long long)dest, props[0].IsSetEnableCurrentValue() ? 1 : 0);
                    if (dest == CrStillImageStoreDestination_MemoryCard &&
                        props[0].IsSetEnableCurrentValue()) {
                        CrDeviceProperty prop = props[0];
                        prop.SetCurrentValue(CrStillImageStoreDestination_HostPCAndMemoryCard);
                        CrError setDestErr = SCRSDK::SetDeviceProperty(device->handle, &prop);
                        fprintf(stderr, "[SonyBridge] Switched store dest -> HostPCAndMemoryCard => 0x%08X\n",
                                (unsigned)setDestErr);
                    }
                }
                if (props) {
                    SCRSDK::ReleaseDeviceProperties(device->handle, props);
                }
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

    clear_dir_files(device->save_dir, true);
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
        struct CaptureActiveGuard {
            BridgeDeviceCallback* cb;
            const std::string& dir;
            ~CaptureActiveGuard() {
                if (cb) {
                    std::lock_guard<std::mutex> lk(cb->mtx);
                    cb->capturing_active = false;
                }
                clear_dir_files(dir, false);
            }
        } guard{device->callback, device->save_dir};

        clear_dir_files(device->save_dir, false);

        /* Reset per-capture state before firing shutter */
        {
            std::lock_guard<std::mutex> lock(device->callback->mtx);
            device->callback->capturing_active = true;
            device->callback->exposure_started = false;
            device->callback->capture_complete = false;
            device->callback->postview_ready = false;
            device->callback->all_download_complete = false;
            device->callback->postview_size = 0;
            device->callback->download_filenames.clear();
            device->callback->postview_filename.clear();
        }

        fprintf(stderr, "[SonyBridge] Capture started\n");

        /* Attempt 1: S1andRelease Down -> hold until exposure starts (AF lock) -> Up */
        CrError result = SCRSDK::SendCommand(
            device->handle,
            CrCommandId_S1andRelease,
            CrCommandParam_Down
        );
        if (result == CrError_None) {
            {
                std::unique_lock<std::mutex> lock(device->callback->mtx);
                device->callback->cv.wait_for(
                    lock,
                    std::chrono::milliseconds(1600),
                    [&] {
                        return device->callback->exposure_started.load() ||
                               device->callback->capture_complete.load() ||
                               device->callback->postview_ready.load();
                    }
                );
            }
            /* Brief settle so shutter release completes cleanly before lifting button */
            std::this_thread::sleep_for(std::chrono::milliseconds(60));
            CrError upResult = SCRSDK::SendCommand(
                device->handle,
                CrCommandId_S1andRelease,
                CrCommandParam_Up
            );
            if (upResult != CrError_None) {
                fprintf(stderr, "[SonyBridge] S1andRelease Up returned 0x%08X\n",
                        (unsigned)upResult);
            }

            /* Wait briefly after Up in case CrNotify_Captured_Event / OnCompleteDownload arrives */
            if (!device->callback->exposure_started.load() &&
                !device->callback->capture_complete.load() &&
                !device->callback->postview_ready.load()) {
                std::unique_lock<std::mutex> lock(device->callback->mtx);
                device->callback->cv.wait_for(
                    lock,
                    std::chrono::milliseconds(1400),
                    [&] {
                        return device->callback->exposure_started.load() ||
                               device->callback->capture_complete.load() ||
                               device->callback->postview_ready.load();
                    }
                );
            }
        } else {
            fprintf(stderr, "[SonyBridge] S1andRelease Down failed: 0x%08X\n",
                    (unsigned)result);
            SCRSDK::SendCommand(device->handle, CrCommandId_S1andRelease, CrCommandParam_Up);
        }

        /* Attempt 2 fallback: explicit S1 lock + CrCommandId_Release (older PTP bodies / retry) */
        bool triggered = device->callback->exposure_started.load() ||
                         device->callback->capture_complete.load() ||
                         device->callback->postview_ready.load();
        if (!triggered) {
            fprintf(stderr, "[SonyBridge] S1andRelease did not trigger exposure; trying S1 + Release\n");
            try_set_device_property(device->handle, CrDeviceProperty_S1, CrLockIndicator_Unlocked);
            std::this_thread::sleep_for(std::chrono::milliseconds(60));
            try_set_device_property(device->handle, CrDeviceProperty_S1, CrLockIndicator_Locked);
            std::this_thread::sleep_for(std::chrono::milliseconds(450));

            CrError relDown = SCRSDK::SendCommand(
                device->handle, CrCommandId_Release, CrCommandParam_Down);
            if (relDown == CrError_None) {
                {
                    std::unique_lock<std::mutex> lock(device->callback->mtx);
                    device->callback->cv.wait_for(
                        lock,
                        std::chrono::milliseconds(1200),
                        [&] {
                            return device->callback->exposure_started.load() ||
                                   device->callback->capture_complete.load() ||
                                   device->callback->postview_ready.load();
                        }
                    );
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(60));
                SCRSDK::SendCommand(device->handle, CrCommandId_Release, CrCommandParam_Up);
            } else {
                fprintf(stderr, "[SonyBridge] CrCommandId_Release Down failed: 0x%08X\n",
                        (unsigned)relDown);
                SCRSDK::SendCommand(device->handle, CrCommandId_Release, CrCommandParam_Up);
            }
            try_set_device_property(device->handle, CrDeviceProperty_S1, CrLockIndicator_Unlocked);

            if (!device->callback->exposure_started.load() &&
                !device->callback->capture_complete.load() &&
                !device->callback->postview_ready.load()) {
                std::unique_lock<std::mutex> lock(device->callback->mtx);
                device->callback->cv.wait_for(
                    lock,
                    std::chrono::milliseconds(800),
                    [&] {
                        return device->callback->exposure_started.load() ||
                               device->callback->capture_complete.load() ||
                               device->callback->postview_ready.load();
                    }
                );
            }
            triggered = device->callback->exposure_started.load() ||
                        device->callback->capture_complete.load() ||
                        device->callback->postview_ready.load();
        }

        if (!triggered) {
            set_error("Shutter failed to release (ensure lens can focus or set Priority to Release)");
            return SONY_ERR_CAPTURE;
        }

        /* Wait for image delivery: OnCompleteDownload (full-res JPEG) or PostView */
        auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(15);
        auto exposure_time = std::chrono::steady_clock::now();
        bool saw_raw_only = false;
        auto raw_first_seen = std::chrono::steady_clock::now();
        size_t checked_files_count = 0;

        while (std::chrono::steady_clock::now() < deadline) {
            std::vector<std::string> files_copy;
            bool pv_ready = false;
            CrInt32u pv_size = 0;
            std::string pv_file;
            bool cap_complete = false;
            bool exp_started = false;

            {
                std::unique_lock<std::mutex> lock(device->callback->mtx);
                device->callback->cv.wait_for(
                    lock,
                    std::chrono::milliseconds(250),
                    [&] {
                        return device->callback->download_filenames.size() > checked_files_count ||
                               device->callback->postview_ready.load();
                    }
                );
                files_copy = device->callback->download_filenames;
                checked_files_count = files_copy.size();
                pv_ready = device->callback->postview_ready.load();
                pv_size = device->callback->postview_size.load();
                pv_file = device->callback->postview_filename;
                cap_complete = device->callback->capture_complete.load();
                exp_started = device->callback->exposure_started.load();
            }

            /* Priority 1: Valid JPEG downloaded via SetSaveInfo + OnCompleteDownload */
            for (const auto& fpath : files_copy) {
                std::string lower = fpath;
                std::transform(lower.begin(), lower.end(), lower.begin(),
                               [](unsigned char c) { return (char)std::tolower(c); });
                bool is_raw = (lower.size() >= 4 &&
                               (lower.compare(lower.size() - 4, 4, ".arw") == 0 ||
                                lower.compare(lower.size() - 4, 4, ".dng") == 0));
                if (is_raw) {
                    if (!saw_raw_only) {
                        saw_raw_only = true;
                        raw_first_seen = std::chrono::steady_clock::now();
                    }
                    continue;
                }

                uint8_t* jpg_buf = nullptr;
                size_t jpg_len = 0;
                if (read_valid_jpeg_file(fpath, &jpg_buf, &jpg_len)) {
                    /* Give companion download a tiny window to finish if still active */
                    if (!device->callback->all_download_complete.load()) {
                        std::unique_lock<std::mutex> lock(device->callback->mtx);
                        device->callback->cv.wait_for(
                            lock,
                            std::chrono::milliseconds(250),
                            [&] { return device->callback->all_download_complete.load(); }
                        );
                    }
                    fprintf(stderr, "[SonyBridge] Returning downloaded JPEG (%zu bytes) from %s\n",
                            jpg_len, fpath.c_str());
                    *image_data = jpg_buf;
                    *image_len = jpg_len;
                    return SONY_OK;
                }
            }

            /* Priority 2: Valid PostView JPEG (file or RAM) */
            if (pv_ready) {
                if (!pv_file.empty() && ends_with_jpeg_ci(pv_file)) {
                    uint8_t* jpg_buf = nullptr;
                    size_t jpg_len = 0;
                    if (read_valid_jpeg_file(pv_file, &jpg_buf, &jpg_len)) {
                        fprintf(stderr, "[SonyBridge] Returning PostView file JPEG (%zu bytes)\n",
                                jpg_len);
                        *image_data = jpg_buf;
                        *image_len = jpg_len;
                        return SONY_OK;
                    }
                }
                if (pv_size >= 128) {
                    uint8_t* pvBuf = (uint8_t*)malloc(pv_size);
                    if (pvBuf) {
                        CrError pvResult = SCRSDK::PullPostViewImage(device->handle, pvBuf, pv_size);
                        if (pvResult == CrError_None && is_valid_jpeg(pvBuf, pv_size)) {
                            fprintf(stderr, "[SonyBridge] Returning PostView RAM JPEG (%u bytes)\n",
                                    (unsigned)pv_size);
                            *image_data = pvBuf;
                            *image_len = pv_size;
                            return SONY_OK;
                        }
                        fprintf(stderr, "[SonyBridge] PullPostViewImage invalid/failed (err=0x%08X, size=%u)\n",
                                (unsigned)pvResult, (unsigned)pv_size);
                        free(pvBuf);
                    }
                }
                /* Clear invalid postview flag so we keep waiting for OnCompleteDownload */
                device->callback->postview_ready = false;
            }

            /* If camera is in RAW-only mode, wait max 3s after .ARW for a companion JPEG */
            if (saw_raw_only &&
                std::chrono::steady_clock::now() - raw_first_seen > std::chrono::seconds(3)) {
                fprintf(stderr, "[SonyBridge] Only RAW file received; falling back to LiveView JPEG\n");
                break;
            }

            /* If exposure started and no PC download starts within 4.5s (e.g. Camera Only), fallback */
            if (exp_started && !cap_complete && files_copy.empty() &&
                std::chrono::steady_clock::now() - exposure_time > std::chrono::milliseconds(4500)) {
                fprintf(stderr, "[SonyBridge] No PC file download in 4.5s; falling back to LiveView JPEG\n");
                break;
            }
        }

        /* Priority 3: Grab a validated JPEG LiveView frame (only after confirmed shutter exposure) */
        {
            const size_t BUF_SIZE = 1920 * 1080 * 3;
            uint8_t* lvBuf = (uint8_t*)malloc(BUF_SIZE);
            if (!lvBuf) {
                set_error("Failed to allocate live view buffer");
                return SONY_ERR_UNKNOWN;
            }

            for (int attempt = 0; attempt < 8; attempt++) {
                std::this_thread::sleep_for(std::chrono::milliseconds(attempt == 0 ? 150 : 100));
                CrImageDataBlock lvBlock;
                lvBlock.SetSize((CrInt32u)BUF_SIZE);
                lvBlock.SetData(lvBuf);

                CrError lvResult = SCRSDK::GetLiveViewImage(device->handle, &lvBlock);
                CrInt32u lvSize = lvBlock.GetImageSize();
                const uint8_t* lvPtr = lvBlock.GetImageData();
                if (lvResult == CrError_None && lvSize >= 128 && lvSize <= BUF_SIZE &&
                    is_valid_jpeg(lvPtr, lvSize)) {
                    uint8_t* out = (uint8_t*)malloc(lvSize);
                    if (out) {
                        memcpy(out, lvPtr, lvSize);
                        free(lvBuf);
                        fprintf(stderr, "[SonyBridge] Returning LiveView fallback JPEG (%u bytes)\n",
                                (unsigned)lvSize);
                        *image_data = out;
                        *image_len = lvSize;
                        return SONY_OK;
                    }
                }
            }
            free(lvBuf);
        }

        set_error("Capture completed but no valid JPEG image data was produced");
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
