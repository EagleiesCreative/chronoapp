/*
 * libgphoto2 — Rust FFI Module
 *
 * Dynamically loads libgphoto2.dylib at runtime via libloading (installed via
 * `brew install gphoto2`) to support direct USB live view and full-resolution
 * shutter capture for cameras not covered by the bundled Sony CrSDK / Canon EDSDK
 * (e.g. Sony A7R III / ILCE-7RM3 and Canon EOS 80D).
 *
 * When libgphoto2 is not present, GPhoto2Sdk::load() returns Err and gphoto2
 * camera discovery is silently skipped.
 */

use libloading::Library;
use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_int, c_ulong, c_void, CStr};
use std::path::PathBuf;
use std::ptr;
use std::sync::OnceLock;

const GP_OK: c_int = 0;
const GP_CAPTURE_IMAGE: c_int = 0;
const GP_FILE_TYPE_NORMAL: c_int = 1;

#[repr(C)]
#[derive(Clone)]
struct CameraFilePath {
    name: [c_char; 128],
    folder: [c_char; 1024],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GPhoto2CameraInfo {
    pub id: String,
    pub name: String,
    pub port: String,
}

#[allow(clippy::type_complexity)]
struct GPhoto2Api {
    context_new: unsafe extern "C" fn() -> *mut c_void,
    context_unref: unsafe extern "C" fn(*mut c_void),
    list_new: unsafe extern "C" fn(*mut *mut c_void) -> c_int,
    list_free: unsafe extern "C" fn(*mut c_void) -> c_int,
    list_count: unsafe extern "C" fn(*mut c_void) -> c_int,
    list_get_name: unsafe extern "C" fn(*mut c_void, c_int, *mut *const c_char) -> c_int,
    list_get_value: unsafe extern "C" fn(*mut c_void, c_int, *mut *const c_char) -> c_int,
    camera_new: unsafe extern "C" fn(*mut *mut c_void) -> c_int,
    camera_free: unsafe extern "C" fn(*mut c_void) -> c_int,
    camera_autodetect: unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int,
    camera_init: unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int,
    camera_exit: unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int,
    camera_capture_preview: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> c_int,
    camera_capture:
        unsafe extern "C" fn(*mut c_void, c_int, *mut CameraFilePath, *mut c_void) -> c_int,
    camera_file_get: unsafe extern "C" fn(
        *mut c_void,
        *const c_char,
        *const c_char,
        c_int,
        *mut c_void,
        *mut c_void,
    ) -> c_int,
    camera_file_delete:
        unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char, *mut c_void) -> c_int,
    file_new: unsafe extern "C" fn(*mut *mut c_void) -> c_int,
    file_free: unsafe extern "C" fn(*mut c_void) -> c_int,
    file_get_data_and_size:
        unsafe extern "C" fn(*mut c_void, *mut *const c_char, *mut c_ulong) -> c_int,
}

static GPHOTO2_LIB: OnceLock<Library> = OnceLock::new();
static GPHOTO2_API: OnceLock<GPhoto2Api> = OnceLock::new();

fn gphoto2_api() -> Result<&'static GPhoto2Api, String> {
    GPHOTO2_API
        .get()
        .ok_or_else(|| "libgphoto2 not initialised".to_string())
}

fn kill_ptp_camera() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("killall")
            .args(["-9", "PTPCamera"])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

fn gphoto2_library_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/lib/libgphoto2.dylib"));
        candidates.push(PathBuf::from("/usr/local/lib/libgphoto2.dylib"));
        candidates.push(PathBuf::from("libs/libgphoto2.dylib"));
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("../Frameworks/libgphoto2.dylib"));
                candidates.push(dir.join("libs/libgphoto2.dylib"));
            }
        }
    } else if cfg!(target_os = "linux") {
        candidates.push(PathBuf::from("/usr/lib/libgphoto2.so"));
        candidates.push(PathBuf::from("/usr/local/lib/libgphoto2.so"));
    }

    candidates.into_iter().find(|p| p.exists())
}

pub struct GPhoto2Sdk;

impl GPhoto2Sdk {
    /// Load libgphoto2 dynamically once. Cheap no-op on subsequent calls.
    pub fn load() -> Result<Self, String> {
        if GPHOTO2_API.get().is_some() {
            return Ok(Self);
        }

        let lib_path = gphoto2_library_path().ok_or_else(|| {
            "libgphoto2 not found. Install via `brew install gphoto2`.".to_string()
        })?;

        unsafe {
            let lib = Library::new(&lib_path)
                .map_err(|e| format!("Failed to load libgphoto2 from {:?}: {}", lib_path, e))?;

            macro_rules! sym {
                ($name:expr, $t:ty) => {{
                    let s = lib.get::<$t>($name).map_err(|e| {
                        format!(
                            "libgphoto2 symbol {} not found: {}",
                            String::from_utf8_lossy($name),
                            e
                        )
                    })?;
                    *s
                }};
            }

            let api = GPhoto2Api {
                context_new: sym!(b"gp_context_new", unsafe extern "C" fn() -> *mut c_void),
                context_unref: sym!(b"gp_context_unref", unsafe extern "C" fn(*mut c_void)),
                list_new: sym!(b"gp_list_new", unsafe extern "C" fn(*mut *mut c_void) -> c_int),
                list_free: sym!(b"gp_list_free", unsafe extern "C" fn(*mut c_void) -> c_int),
                list_count: sym!(b"gp_list_count", unsafe extern "C" fn(*mut c_void) -> c_int),
                list_get_name: sym!(
                    b"gp_list_get_name",
                    unsafe extern "C" fn(*mut c_void, c_int, *mut *const c_char) -> c_int
                ),
                list_get_value: sym!(
                    b"gp_list_get_value",
                    unsafe extern "C" fn(*mut c_void, c_int, *mut *const c_char) -> c_int
                ),
                camera_new: sym!(
                    b"gp_camera_new",
                    unsafe extern "C" fn(*mut *mut c_void) -> c_int
                ),
                camera_free: sym!(b"gp_camera_free", unsafe extern "C" fn(*mut c_void) -> c_int),
                camera_autodetect: sym!(
                    b"gp_camera_autodetect",
                    unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int
                ),
                camera_init: sym!(
                    b"gp_camera_init",
                    unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int
                ),
                camera_exit: sym!(
                    b"gp_camera_exit",
                    unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int
                ),
                camera_capture_preview: sym!(
                    b"gp_camera_capture_preview",
                    unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> c_int
                ),
                camera_capture: sym!(
                    b"gp_camera_capture",
                    unsafe extern "C" fn(*mut c_void, c_int, *mut CameraFilePath, *mut c_void) -> c_int
                ),
                camera_file_get: sym!(
                    b"gp_camera_file_get",
                    unsafe extern "C" fn(
                        *mut c_void,
                        *const c_char,
                        *const c_char,
                        c_int,
                        *mut c_void,
                        *mut c_void,
                    ) -> c_int
                ),
                camera_file_delete: sym!(
                    b"gp_camera_file_delete",
                    unsafe extern "C" fn(
                        *mut c_void,
                        *const c_char,
                        *const c_char,
                        *mut c_void,
                    ) -> c_int
                ),
                file_new: sym!(b"gp_file_new", unsafe extern "C" fn(*mut *mut c_void) -> c_int),
                file_free: sym!(b"gp_file_free", unsafe extern "C" fn(*mut c_void) -> c_int),
                file_get_data_and_size: sym!(
                    b"gp_file_get_data_and_size",
                    unsafe extern "C" fn(*mut c_void, *mut *const c_char, *mut c_ulong) -> c_int
                ),
            };

            let _ = GPHOTO2_LIB.set(lib);
            let _ = GPHOTO2_API.set(api);

            log::info!("libgphoto2 loaded successfully from {:?}", lib_path);
            Ok(Self)
        }
    }

    /// Enumerate USB-connected cameras via gp_camera_autodetect.
    pub fn list_cameras(&self) -> Result<Vec<GPhoto2CameraInfo>, String> {
        let api = gphoto2_api()?;
        kill_ptp_camera();

        unsafe {
            let context = (api.context_new)();
            let mut list: *mut c_void = ptr::null_mut();
            if (api.list_new)(&mut list) < GP_OK || list.is_null() {
                if !context.is_null() {
                    (api.context_unref)(context);
                }
                return Err("gp_list_new failed".to_string());
            }

            let count = (api.camera_autodetect)(list, context);
            let mut cameras = Vec::new();
            if count > 0 {
                let total = (api.list_count)(list);
                for i in 0..total {
                    let mut name_ptr: *const c_char = ptr::null();
                    let mut port_ptr: *const c_char = ptr::null();
                    let name = if (api.list_get_name)(list, i, &mut name_ptr) >= GP_OK
                        && !name_ptr.is_null()
                    {
                        CStr::from_ptr(name_ptr).to_string_lossy().to_string()
                    } else {
                        format!("USB Camera {}", i + 1)
                    };
                    let port = if (api.list_get_value)(list, i, &mut port_ptr) >= GP_OK
                        && !port_ptr.is_null()
                    {
                        CStr::from_ptr(port_ptr).to_string_lossy().to_string()
                    } else {
                        String::new()
                    };

                    cameras.push(GPhoto2CameraInfo {
                        id: format!("gphoto2_{}", i),
                        name,
                        port,
                    });
                }
            }

            (api.list_free)(list);
            if !context.is_null() {
                (api.context_unref)(context);
            }

            log::info!("libgphoto2 detected {} camera(s)", cameras.len());
            Ok(cameras)
        }
    }

    /// Connect to a USB camera via libgphoto2.
    pub fn connect(&self, _index: u32) -> Result<GPhoto2Session, String> {
        let api = gphoto2_api()?;
        kill_ptp_camera();

        unsafe {
            let context = (api.context_new)();
            if context.is_null() {
                return Err("gp_context_new failed".to_string());
            }

            let mut camera: *mut c_void = ptr::null_mut();
            let err = (api.camera_new)(&mut camera);
            if err < GP_OK || camera.is_null() {
                (api.context_unref)(context);
                return Err(format!("gp_camera_new failed: {}", err));
            }

            // Initialize camera; retry once after 500ms if macOS PTPCamera just released USB.
            let mut init_err = (api.camera_init)(camera, context);
            if init_err < GP_OK {
                kill_ptp_camera();
                std::thread::sleep(std::time::Duration::from_millis(500));
                init_err = (api.camera_init)(camera, context);
            }

            if init_err < GP_OK {
                (api.camera_free)(camera);
                (api.context_unref)(context);
                return Err(format!(
                    "gp_camera_init failed (code {}). Ensure camera is in PC Remote / USB mode and not locked by another app.",
                    init_err
                ));
            }

            log::info!("libgphoto2 camera session opened");
            Ok(GPhoto2Session { camera, context })
        }
    }
}

pub struct GPhoto2Session {
    camera: *mut c_void,
    context: *mut c_void,
}

impl GPhoto2Session {
    pub fn is_connected(&self) -> bool {
        !self.camera.is_null()
    }

    /// Grab one live-view preview frame as JPEG bytes.
    pub fn get_live_view_frame(&self) -> Result<Vec<u8>, String> {
        let api = gphoto2_api()?;
        if self.camera.is_null() {
            return Err("libgphoto2 camera not connected".to_string());
        }

        unsafe {
            let mut file: *mut c_void = ptr::null_mut();
            let err = (api.file_new)(&mut file);
            if err < GP_OK || file.is_null() {
                return Err(format!("gp_file_new failed: {}", err));
            }

            let cap_err = (api.camera_capture_preview)(self.camera, file, self.context);
            if cap_err < GP_OK {
                (api.file_free)(file);
                return Err(format!("Live view frame not ready (code {})", cap_err));
            }

            let mut data_ptr: *const c_char = ptr::null();
            let mut size: c_ulong = 0;
            let data_err = (api.file_get_data_and_size)(file, &mut data_ptr, &mut size);
            let bytes = if data_err >= GP_OK && !data_ptr.is_null() && size > 0 {
                std::slice::from_raw_parts(data_ptr as *const u8, size as usize).to_vec()
            } else {
                Vec::new()
            };

            (api.file_free)(file);

            if bytes.is_empty() {
                return Err("Empty live view frame from libgphoto2".to_string());
            }
            Ok(bytes)
        }
    }

    /// Trigger actual shutter capture and download the full-resolution JPEG.
    pub fn capture_still(&self) -> Result<Vec<u8>, String> {
        let api = gphoto2_api()?;
        if self.camera.is_null() {
            return Err("libgphoto2 camera not connected".to_string());
        }

        let mut last_err = String::new();
        for attempt in 0..2 {
            unsafe {
                let mut path: CameraFilePath = std::mem::zeroed();
                let cap_err =
                    (api.camera_capture)(self.camera, GP_CAPTURE_IMAGE, &mut path, self.context);
                if cap_err < GP_OK {
                    last_err = format!("gp_camera_capture failed (code {})", cap_err);
                    if attempt == 0 {
                        std::thread::sleep(std::time::Duration::from_millis(250));
                        continue;
                    }
                    break;
                }

                let mut file: *mut c_void = ptr::null_mut();
                let new_err = (api.file_new)(&mut file);
                if new_err < GP_OK || file.is_null() {
                    last_err = format!("gp_file_new failed (code {})", new_err);
                    break;
                }

                let get_err = (api.camera_file_get)(
                    self.camera,
                    path.folder.as_ptr(),
                    path.name.as_ptr(),
                    GP_FILE_TYPE_NORMAL,
                    file,
                    self.context,
                );

                let bytes = if get_err >= GP_OK {
                    let mut data_ptr: *const c_char = ptr::null();
                    let mut size: c_ulong = 0;
                    if (api.file_get_data_and_size)(file, &mut data_ptr, &mut size) >= GP_OK
                        && !data_ptr.is_null()
                        && size > 0
                    {
                        std::slice::from_raw_parts(data_ptr as *const u8, size as usize).to_vec()
                    } else {
                        Vec::new()
                    }
                } else {
                    last_err = format!("gp_camera_file_get failed (code {})", get_err);
                    Vec::new()
                };

                // Clean up captured file on camera RAM/card if applicable
                let _ = (api.camera_file_delete)(
                    self.camera,
                    path.folder.as_ptr(),
                    path.name.as_ptr(),
                    self.context,
                );
                (api.file_free)(file);

                if !bytes.is_empty() {
                    log::info!(
                        "libgphoto2 capture complete: {} bytes ({:.1} MB)",
                        bytes.len(),
                        bytes.len() as f64 / (1024.0 * 1024.0)
                    );
                    return Ok(bytes);
                }
            }
        }

        // Fallback to live view frame only if shutter capture failed after retry
        if let Ok(frame) = self.get_live_view_frame() {
            log::warn!(
                "libgphoto2 shutter capture failed ({}); falling back to live view frame",
                last_err
            );
            return Ok(frame);
        }

        Err(if last_err.is_empty() {
            "libgphoto2 capture returned empty image".to_string()
        } else {
            last_err
        })
    }
}

impl Drop for GPhoto2Session {
    fn drop(&mut self) {
        if let Ok(api) = gphoto2_api() {
            unsafe {
                if !self.camera.is_null() {
                    let _ = (api.camera_exit)(self.camera, self.context);
                    let _ = (api.camera_free)(self.camera);
                    self.camera = ptr::null_mut();
                }
                if !self.context.is_null() {
                    (api.context_unref)(self.context);
                    self.context = ptr::null_mut();
                }
            }
        }
        log::info!("libgphoto2 camera session closed");
    }
}

