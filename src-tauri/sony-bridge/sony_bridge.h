/*
 * Sony Camera Remote SDK — C Bridge Header
 *
 * This thin C-compatible wrapper around the Sony CrSDK C++ API enables
 * Rust to call into the SDK via libloading / FFI.
 *
 * Build: see CMakeLists.txt in this directory.
 * Output: libsony_bridge.dylib (macOS) / sony_bridge.dll (Windows)
 */

#ifndef SONY_BRIDGE_H
#define SONY_BRIDGE_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ---------- Error codes ------------------------------------------------- */
#define SONY_OK              0
#define SONY_ERR_INIT       -1
#define SONY_ERR_ENUM       -2
#define SONY_ERR_CONNECT    -3
#define SONY_ERR_CAPTURE    -4
#define SONY_ERR_LIVEVIEW   -5
#define SONY_ERR_PROPERTY   -6
#define SONY_ERR_NOT_READY  -7
#define SONY_ERR_TIMEOUT    -8
#define SONY_ERR_UNKNOWN    -99

/* ---------- Data structures --------------------------------------------- */

#define SONY_MAX_CAMERA_NAME  256

typedef struct {
    int      index;
    char     name[SONY_MAX_CAMERA_NAME];
    char     model[SONY_MAX_CAMERA_NAME];
    uint32_t connection_type;   /* 0=USB, 1=Network */
} SonyCameraInfo;

typedef void* SonyDeviceHandle;

/* ---------- SDK Lifecycle ----------------------------------------------- */

/**
 * Initialize the Sony Camera Remote SDK.
 * Must be called once before any other functions.
 * Returns SONY_OK on success.
 */
int sony_sdk_init(void);

/**
 * Shut down the SDK and release all resources.
 */
void sony_sdk_release(void);

/* ---------- Camera Discovery -------------------------------------------- */

/**
 * Enumerate connected Sony cameras.
 * @param cameras   Output array (caller allocated)
 * @param max_count Maximum number of cameras to return
 * @return          Number of cameras found, or negative error code
 */
int sony_enum_cameras(SonyCameraInfo* cameras, int max_count);

/* ---------- Connection -------------------------------------------------- */

/**
 * Connect to a camera by index (from sony_enum_cameras).
 * @param camera_index  Zero-based index
 * @return              Device handle, or NULL on failure
 */
SonyDeviceHandle sony_connect(int camera_index);

/**
 * Disconnect from a camera and release the handle.
 */
void sony_disconnect(SonyDeviceHandle handle);

/**
 * Check if the camera is connected and ready.
 * @return 1 if connected, 0 if not
 */
int sony_is_connected(SonyDeviceHandle handle);

/* ---------- Still Image Capture ----------------------------------------- */

/**
 * Trigger shutter release and download the captured image.
 *
 * This performs a half-press → full-press → release sequence, waits for
 * the capture to complete, then downloads the JPEG from the camera.
 *
 * @param handle      Device handle from sony_connect
 * @param image_data  Output: pointer to JPEG data (caller must free with sony_free_image)
 * @param image_len   Output: length of JPEG data in bytes
 * @return            SONY_OK on success, negative error code on failure
 */
int sony_capture_still(SonyDeviceHandle handle,
                       uint8_t** image_data,
                       size_t* image_len);

/**
 * Free image data returned by sony_capture_still.
 */
void sony_free_image(uint8_t* image_data);

/* ---------- Live View --------------------------------------------------- */

/**
 * Start live view streaming from the camera.
 * After this call, sony_get_live_view_frame() returns preview frames.
 */
int sony_start_live_view(SonyDeviceHandle handle);

/**
 * Get a single live view frame (JPEG).
 *
 * @param handle       Device handle
 * @param frame_data   Output: pointer to JPEG data (caller must free with sony_free_image)
 * @param frame_len    Output: length of JPEG data in bytes
 * @return             SONY_OK on success, SONY_ERR_NOT_READY if no frame available
 */
int sony_get_live_view_frame(SonyDeviceHandle handle,
                             uint8_t** frame_data,
                             size_t* frame_len);

/**
 * Stop live view streaming.
 */
int sony_stop_live_view(SonyDeviceHandle handle);

/* ---------- Device Properties ------------------------------------------- */

/**
 * Set a camera property (e.g. ISO, aperture, shutter speed).
 * Property IDs are defined in CrDeviceProperty.h from the CrSDK.
 */
int sony_set_property(SonyDeviceHandle handle,
                      uint32_t property_id,
                      uint64_t value);

/**
 * Get a camera property value.
 */
int sony_get_property(SonyDeviceHandle handle,
                      uint32_t property_id,
                      uint64_t* value);

/* ---------- Utility ----------------------------------------------------- */

/**
 * Kill macOS PTPCamera process that may be blocking USB access.
 * Safe to call on any platform (no-op on non-macOS).
 */
void sony_kill_ptpcamera(void);

/**
 * Get the last error message (thread-local).
 * Returns a static string — do NOT free.
 */
const char* sony_get_last_error(void);

#ifdef __cplusplus
}
#endif

#endif /* SONY_BRIDGE_H */
