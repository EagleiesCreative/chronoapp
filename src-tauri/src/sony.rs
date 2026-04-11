/*
 * Sony Camera Remote SDK — Rust FFI Module
 *
 * Dynamically loads libsony_bridge.dylib (or sony_bridge.dll / libsony_bridge.so)
 * at runtime via libloading, following the same pattern as canon.rs.
 *
 * When the bridge library is not present, SonySdk::load() returns Err
 * and Sony features are silently disabled — the app still works with
 * system cameras and Canon cameras.
 */

use libloading::{Library, Symbol};
use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_int, c_void, CStr};
use std::path::Path;
use std::ptr;

/* ----------------------------------------------------------------
 * Constants (mirror sony_bridge.h)
 * ---------------------------------------------------------------- */

pub const SONY_OK: c_int = 0;
pub const _SONY_ERR_INIT: c_int = -1;
pub const _SONY_ERR_ENUM: c_int = -2;
pub const _SONY_ERR_CONNECT: c_int = -3;
pub const _SONY_ERR_CAPTURE: c_int = -4;
pub const _SONY_ERR_LIVEVIEW: c_int = -5;
pub const _SONY_ERR_PROPERTY: c_int = -6;
pub const SONY_ERR_NOT_READY: c_int = -7;
pub const _SONY_ERR_TIMEOUT: c_int = -8;

pub const SONY_MAX_CAMERA_NAME: usize = 256;

/* ----------------------------------------------------------------
 * FFI types (mirror sony_bridge.h structs)
 * ---------------------------------------------------------------- */

#[repr(C)]
#[derive(Clone)]
pub struct SonyCameraInfoC {
    pub index: c_int,
    pub name: [c_char; SONY_MAX_CAMERA_NAME],
    pub model: [c_char; SONY_MAX_CAMERA_NAME],
    pub connection_type: u32,
}

impl SonyCameraInfoC {
    fn name_str(&self) -> String {
        unsafe {
            CStr::from_ptr(self.name.as_ptr())
                .to_string_lossy()
                .to_string()
        }
    }

    fn model_str(&self) -> String {
        unsafe {
            CStr::from_ptr(self.model.as_ptr())
                .to_string_lossy()
                .to_string()
        }
    }
}

impl Default for SonyCameraInfoC {
    fn default() -> Self {
        Self {
            index: 0,
            name: [0; SONY_MAX_CAMERA_NAME],
            model: [0; SONY_MAX_CAMERA_NAME],
            connection_type: 0,
        }
    }
}

/* ----------------------------------------------------------------
 * Public Rust types
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonyCameraInfo {
    pub id: String,
    pub name: String,
    pub model: String,
    pub connection_type: u32,
}

/* ----------------------------------------------------------------
 * Sony SDK wrapper
 * ---------------------------------------------------------------- */

pub struct SonySdk {
    lib: Library,
}

impl SonySdk {
    /// Attempt to load the Sony bridge library.
    /// Returns Err if the library is not found (Sony features disabled).
    pub fn load() -> Result<Self, String> {
        let lib_path = if cfg!(target_os = "macos") {
            "libs/libsony_bridge.dylib"
        } else if cfg!(target_os = "windows") {
            "libs/sony_bridge.dll"
        } else {
            "libs/libsony_bridge.so"
        };

        if !Path::new(lib_path).exists() {
            return Err(format!(
                "Sony bridge library not found at '{}'. Sony camera support is disabled.",
                lib_path
            ));
        }

        unsafe {
            let lib = Library::new(lib_path)
                .map_err(|e| format!("Failed to load Sony bridge: {}", e))?;

            // Kill PTPCamera on macOS before initializing
            if let Ok(kill_fn) = lib.get::<unsafe extern "C" fn()>(b"sony_kill_ptpcamera") {
                kill_fn();
            }

            // Initialize the SDK
            let init_fn: Symbol<unsafe extern "C" fn() -> c_int> =
                lib.get(b"sony_sdk_init")
                    .map_err(|e| format!("Symbol sony_sdk_init not found: {}", e))?;

            let result = init_fn();
            if result != SONY_OK {
                let err_msg = Self::get_error_from_lib(&lib);
                return Err(format!("Sony SDK init failed: {}", err_msg));
            }

            log::info!("Sony Camera Remote SDK initialized successfully");
            Ok(Self { lib })
        }
    }

    /// List connected Sony cameras.
    pub fn list_cameras(&self) -> Result<Vec<SonyCameraInfo>, String> {
        const MAX_CAMERAS: usize = 16;
        let mut cameras = vec![SonyCameraInfoC::default(); MAX_CAMERAS];

        unsafe {
            let enum_fn: Symbol<
                unsafe extern "C" fn(*mut SonyCameraInfoC, c_int) -> c_int,
            > = self
                .lib
                .get(b"sony_enum_cameras")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            let count = enum_fn(cameras.as_mut_ptr(), MAX_CAMERAS as c_int);
            if count < 0 {
                let err = self.get_error();
                return Err(format!("Sony camera enumeration failed: {}", err));
            }

            let result: Vec<SonyCameraInfo> = cameras[..count as usize]
                .iter()
                .map(|c| SonyCameraInfo {
                    id: format!("sony_{}", c.index),
                    name: c.name_str(),
                    model: c.model_str(),
                    connection_type: c.connection_type,
                })
                .collect();

            log::info!("Found {} Sony camera(s)", result.len());
            Ok(result)
        }
    }

    /// Connect to a Sony camera by its CrSDK index.
    pub fn connect(&self, camera_index: u32) -> Result<SonySession<'_>, String> {
        unsafe {
            let connect_fn: Symbol<unsafe extern "C" fn(c_int) -> *mut c_void> = self
                .lib
                .get(b"sony_connect")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            let handle = connect_fn(camera_index as c_int);
            if handle.is_null() {
                let err = self.get_error();
                return Err(format!("Failed to connect to Sony camera: {}", err));
            }

            log::info!("Connected to Sony camera (index {})", camera_index);
            Ok(SonySession {
                handle,
                lib: &self.lib,
            })
        }
    }

    /// Get the last error message from the bridge library.
    fn get_error(&self) -> String {
        unsafe { Self::get_error_from_lib(&self.lib) }
    }

    unsafe fn get_error_from_lib(lib: &Library) -> String {
        if let Ok(err_fn) = lib.get::<unsafe extern "C" fn() -> *const c_char>(b"sony_get_last_error") {
            let ptr = err_fn();
            if !ptr.is_null() {
                return CStr::from_ptr(ptr).to_string_lossy().to_string();
            }
        }
        "Unknown error".to_string()
    }
}

impl Drop for SonySdk {
    fn drop(&mut self) {
        unsafe {
            if let Ok(release_fn) =
                self.lib.get::<unsafe extern "C" fn()>(b"sony_sdk_release")
            {
                release_fn();
                log::info!("Sony SDK released");
            }
        }
    }
}

/* ----------------------------------------------------------------
 * Sony camera session — connected device handle
 * ---------------------------------------------------------------- */

pub struct SonySession<'a> {
    handle: *mut c_void,
    lib: &'a Library,
}

impl<'a> SonySession<'a> {
    /// Check if the camera is still connected.
    pub fn is_connected(&self) -> bool {
        unsafe {
            if let Ok(fn_ptr) = self
                .lib
                .get::<unsafe extern "C" fn(*mut c_void) -> c_int>(b"sony_is_connected")
            {
                fn_ptr(self.handle) == 1
            } else {
                false
            }
        }
    }

    /// Trigger shutter release and download the full-resolution image.
    /// Returns the JPEG image data as raw bytes.
    pub fn capture_still(&self) -> Result<Vec<u8>, String> {
        unsafe {
            let capture_fn: Symbol<
                unsafe extern "C" fn(
                    *mut c_void,
                    *mut *mut u8,
                    *mut usize,
                ) -> c_int,
            > = self
                .lib
                .get(b"sony_capture_still")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            let free_fn: Symbol<unsafe extern "C" fn(*mut u8)> = self
                .lib
                .get(b"sony_free_image")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            let mut data_ptr: *mut u8 = ptr::null_mut();
            let mut data_len: usize = 0;

            let result = capture_fn(self.handle, &mut data_ptr, &mut data_len);
            if result != SONY_OK {
                return Err(format!("Sony capture failed (code {})", result));
            }

            if data_ptr.is_null() || data_len == 0 {
                return Err("Sony capture returned empty image".to_string());
            }

            // Copy data to Rust-owned Vec, then free the C allocation
            let image_data = std::slice::from_raw_parts(data_ptr, data_len).to_vec();
            free_fn(data_ptr);

            log::info!(
                "Sony capture complete: {} bytes ({:.1} MB)",
                image_data.len(),
                image_data.len() as f64 / (1024.0 * 1024.0)
            );

            Ok(image_data)
        }
    }

    /// Start live view streaming.
    pub fn start_live_view(&self) -> Result<(), String> {
        unsafe {
            let start_fn: Symbol<unsafe extern "C" fn(*mut c_void) -> c_int> = self
                .lib
                .get(b"sony_start_live_view")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            let result = start_fn(self.handle);
            if result != SONY_OK {
                return Err(format!("Failed to start live view (code {})", result));
            }
            Ok(())
        }
    }

    /// Get a single live view preview frame (JPEG bytes).
    /// Returns Err if no frame is available yet.
    pub fn get_live_view_frame(&self) -> Result<Vec<u8>, String> {
        unsafe {
            let frame_fn: Symbol<
                unsafe extern "C" fn(
                    *mut c_void,
                    *mut *mut u8,
                    *mut usize,
                ) -> c_int,
            > = self
                .lib
                .get(b"sony_get_live_view_frame")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            let free_fn: Symbol<unsafe extern "C" fn(*mut u8)> = self
                .lib
                .get(b"sony_free_image")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            let mut data_ptr: *mut u8 = ptr::null_mut();
            let mut data_len: usize = 0;

            let result = frame_fn(self.handle, &mut data_ptr, &mut data_len);
            if result == SONY_ERR_NOT_READY {
                return Err("No frame ready".to_string());
            }
            if result != SONY_OK {
                return Err(format!("Live view frame error (code {})", result));
            }

            if data_ptr.is_null() || data_len == 0 {
                return Err("Empty live view frame".to_string());
            }

            let frame_data = std::slice::from_raw_parts(data_ptr, data_len).to_vec();
            free_fn(data_ptr);

            Ok(frame_data)
        }
    }

    /// Stop live view streaming.
    pub fn stop_live_view(&self) -> Result<(), String> {
        unsafe {
            let stop_fn: Symbol<unsafe extern "C" fn(*mut c_void) -> c_int> = self
                .lib
                .get(b"sony_stop_live_view")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            let result = stop_fn(self.handle);
            if result != SONY_OK {
                return Err(format!("Failed to stop live view (code {})", result));
            }
            Ok(())
        }
    }

    /// Disconnect this session.
    fn disconnect(&self) {
        unsafe {
            if let Ok(disconnect_fn) = self
                .lib
                .get::<unsafe extern "C" fn(*mut c_void)>(b"sony_disconnect")
            {
                disconnect_fn(self.handle);
            }
        }
    }
}

impl<'a> Drop for SonySession<'a> {
    fn drop(&mut self) {
        self.disconnect();
        log::info!("Sony camera session closed");
    }
}
