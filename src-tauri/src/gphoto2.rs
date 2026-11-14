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
use std::ffi::{c_char, c_int, c_ulong, c_void, CStr, CString};
use std::path::PathBuf;
use std::ptr;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const GP_OK: c_int = 0;
const GP_ERROR_TIMEOUT: c_int = -10;
const GP_CAPTURE_IMAGE: c_int = 0;
const GP_FILE_TYPE_NORMAL: c_int = 1;
const GP_EVENT_UNKNOWN: c_int = 0;
const GP_EVENT_TIMEOUT: c_int = 1;
const GP_EVENT_FILE_ADDED: c_int = 2;
const GP_EVENT_FOLDER_ADDED: c_int = 3;
const GP_EVENT_CAPTURE_COMPLETE: c_int = 4;

extern "C" {
    fn free(ptr: *mut c_void);
}

fn is_valid_jpeg(bytes: &[u8]) -> bool {
    bytes.len() >= 128 && bytes.starts_with(&[0xFF, 0xD8, 0xFF])
}

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
    camera_wait_for_event: unsafe extern "C" fn(
        *mut c_void,
        c_int,
        *mut c_int,
        *mut *mut c_void,
        *mut c_void,
    ) -> c_int,
    camera_get_single_config:
        unsafe extern "C" fn(*mut c_void, *const c_char, *mut *mut c_void, *mut c_void) -> c_int,
    camera_set_single_config:
        unsafe extern "C" fn(*mut c_void, *const c_char, *mut c_void, *mut c_void) -> c_int,
    widget_free: unsafe extern "C" fn(*mut c_void) -> c_int,
    widget_set_value: unsafe extern "C" fn(*mut c_void, *const c_void) -> c_int,
    widget_get_value: unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int,
    widget_set_changed: unsafe extern "C" fn(*mut c_void, c_int) -> c_int,
    widget_count_choices: unsafe extern "C" fn(*mut c_void) -> c_int,
    widget_get_choice: unsafe extern "C" fn(*mut c_void, c_int, *mut *const c_char) -> c_int,
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
        for proc_name in ["PTPCamera", "ptpcamerad"] {
            let _ = std::process::Command::new("killall")
                .args(["-9", proc_name])
                .output();
        }
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
                camera_wait_for_event: sym!(
                    b"gp_camera_wait_for_event",
                    unsafe extern "C" fn(
                        *mut c_void,
                        c_int,
                        *mut c_int,
                        *mut *mut c_void,
                        *mut c_void,
                    ) -> c_int
                ),
                camera_get_single_config: sym!(
                    b"gp_camera_get_single_config",
                    unsafe extern "C" fn(
                        *mut c_void,
                        *const c_char,
                        *mut *mut c_void,
                        *mut c_void,
                    ) -> c_int
                ),
                camera_set_single_config: sym!(
                    b"gp_camera_set_single_config",
                    unsafe extern "C" fn(
                        *mut c_void,
                        *const c_char,
                        *mut c_void,
                        *mut c_void,
                    ) -> c_int
                ),
                widget_free: sym!(
                    b"gp_widget_free",
                    unsafe extern "C" fn(*mut c_void) -> c_int
                ),
                widget_set_value: sym!(
                    b"gp_widget_set_value",
                    unsafe extern "C" fn(*mut c_void, *const c_void) -> c_int
                ),
                widget_get_value: sym!(
                    b"gp_widget_get_value",
                    unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int
                ),
                widget_set_changed: sym!(
                    b"gp_widget_set_changed",
                    unsafe extern "C" fn(*mut c_void, c_int) -> c_int
                ),
                widget_count_choices: sym!(
                    b"gp_widget_count_choices",
                    unsafe extern "C" fn(*mut c_void) -> c_int
                ),
                widget_get_choice: sym!(
                    b"gp_widget_get_choice",
                    unsafe extern "C" fn(*mut c_void, c_int, *mut *const c_char) -> c_int
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
            // Do NOT retry on GP_ERROR_TIMEOUT (-10): that means the camera's PTP stack is not
            // answering at all (usually a session left open by a killed process). A retry just
            // doubles the stall (~25s -> ~51s) and pushes us past the 30s frontend timeout.
            let mut init_err = (api.camera_init)(camera, context);
            if init_err < GP_OK && init_err != GP_ERROR_TIMEOUT {
                let _ = (api.camera_exit)(camera, context);
                kill_ptp_camera();
                std::thread::sleep(std::time::Duration::from_millis(500));
                init_err = (api.camera_init)(camera, context);
            }

            if init_err < GP_OK {
                (api.camera_free)(camera);
                (api.context_unref)(context);
                return Err(format!(
                    "gp_camera_init failed (code {}). {}",
                    init_err,
                    if init_err == GP_ERROR_TIMEOUT {
                        "Camera is not responding over PTP — turn the camera off and on (or unplug/replug USB), then retry."
                    } else {
                        "Ensure camera is in PC Remote / USB mode and not locked by another app."
                    }
                ));
            }

            log::info!("libgphoto2 camera session opened");
            let session = GPhoto2Session { camera, context };
            session.configure_jpeg_transfer();
            let _ = session.drain_events_for_jpeg(Duration::from_millis(200), false);
            Ok(session)
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

    unsafe fn read_choice_widget_value(
        api: &GPhoto2Api,
        widget: *mut c_void,
    ) -> Option<String> {
        let mut cur_ptr: *const c_char = ptr::null();
        if (api.widget_get_value)(widget, &mut cur_ptr as *mut *const c_char as *mut c_void)
            >= GP_OK
            && !cur_ptr.is_null()
        {
            CStr::from_ptr(cur_ptr).to_str().ok().map(|s| s.to_string())
        } else {
            None
        }
    }

    fn get_choice_config_value(&self, name: &str) -> Option<String> {
        let api = gphoto2_api().ok()?;
        if self.camera.is_null() {
            return None;
        }
        let c_name = CString::new(name).ok()?;
        unsafe {
            let mut widget: *mut c_void = ptr::null_mut();
            let err = (api.camera_get_single_config)(
                self.camera,
                c_name.as_ptr(),
                &mut widget,
                self.context,
            );
            if err < GP_OK || widget.is_null() {
                return None;
            }
            let val = if (api.widget_count_choices)(widget) > 0 {
                Self::read_choice_widget_value(api, widget)
            } else {
                None
            };
            let _ = (api.widget_free)(widget);
            val
        }
    }

    fn set_choice_config(&self, name: &str, preferred: &[&str]) -> bool {
        let Ok(api) = gphoto2_api() else {
            return false;
        };
        if self.camera.is_null() {
            return false;
        }
        let Ok(c_name) = CString::new(name) else {
            return false;
        };

        unsafe {
            let mut widget: *mut c_void = ptr::null_mut();
            let err = (api.camera_get_single_config)(
                self.camera,
                c_name.as_ptr(),
                &mut widget,
                self.context,
            );
            if err < GP_OK || widget.is_null() {
                return false;
            }

            let count = (api.widget_count_choices)(widget);
            if count <= 0 {
                let _ = (api.widget_free)(widget);
                return false;
            }

            let current = Self::read_choice_widget_value(api, widget);
            let mut choices = Vec::with_capacity(count as usize);
            for i in 0..count {
                let mut choice_ptr: *const c_char = ptr::null();
                if (api.widget_get_choice)(widget, i, &mut choice_ptr) >= GP_OK
                    && !choice_ptr.is_null()
                {
                    if let Ok(s) = CStr::from_ptr(choice_ptr).to_str() {
                        choices.push(s.to_string());
                    }
                }
            }

            let target = preferred
                .iter()
                .find_map(|p| choices.iter().find(|c| c.eq_ignore_ascii_case(p)).cloned())
                .or_else(|| {
                    choices
                        .iter()
                        .find(|c| {
                            let lower = c.to_ascii_lowercase();
                            lower.contains("jpeg") && !lower.contains("raw") && !lower.contains('+')
                        })
                        .cloned()
                });

            let mut configured = false;
            if let Some(choice) = target {
                if current
                    .as_deref()
                    .is_some_and(|c| c.eq_ignore_ascii_case(&choice))
                {
                    log::info!("libgphoto2 config '{}' already '{}'", name, choice);
                    configured = true;
                } else if let Ok(c_choice) = CString::new(choice.as_str()) {
                    if (api.widget_set_value)(widget, c_choice.as_ptr() as *const c_void) >= GP_OK
                        && (api.widget_set_changed)(widget, 1) >= GP_OK
                        && (api.camera_set_single_config)(
                            self.camera,
                            c_name.as_ptr(),
                            widget,
                            self.context,
                        ) >= GP_OK
                    {
                        log::info!("libgphoto2 config '{}' set to '{}'", name, choice);
                        configured = true;
                    }
                }
            }

            let _ = (api.widget_free)(widget);
            configured
        }
    }

    fn set_toggle_config(&self, name: &str, value: c_int) -> Result<(), String> {
        let api = gphoto2_api()?;
        if self.camera.is_null() {
            return Err("libgphoto2 camera not connected".to_string());
        }
        let c_name = CString::new(name).map_err(|e| e.to_string())?;

        unsafe {
            let mut widget: *mut c_void = ptr::null_mut();
            let get_err = (api.camera_get_single_config)(
                self.camera,
                c_name.as_ptr(),
                &mut widget,
                self.context,
            );
            if get_err < GP_OK || widget.is_null() {
                return Err(format!(
                    "gp_camera_get_single_config('{}') failed (code {})",
                    name, get_err
                ));
            }

            let val: c_int = value;
            let val_err = (api.widget_set_value)(widget, &val as *const c_int as *const c_void);
            let result = if val_err >= GP_OK {
                let _ = (api.widget_set_changed)(widget, 1);
                let set_err = (api.camera_set_single_config)(
                    self.camera,
                    c_name.as_ptr(),
                    widget,
                    self.context,
                );
                if set_err >= GP_OK {
                    Ok(())
                } else {
                    Err(format!(
                        "gp_camera_set_single_config('{}') failed (code {})",
                        name, set_err
                    ))
                }
            } else {
                Err(format!(
                    "gp_widget_set_value('{}') failed (code {})",
                    name, val_err
                ))
            };

            let _ = (api.widget_free)(widget);
            result
        }
    }

    /// Best-effort configuration so PTP transfer produces JPEG frames rather than 40+ MB RAW files.
    fn configure_jpeg_transfer(&self) {
        // 42MP frames are far bigger than a print strip needs and make compositing slow.
        let _ = self.set_choice_config("imagesize", &["Medium", "M"]);
        // Drive mode must be single shot: in continuous ("Power Wind") mode the PC-remote
        // shutter press fires a burst and floods the camera buffer, freezing live view.
        let _ = self.set_choice_config("capturemode", &["Single Shot", "Single"]);
        let pc_save_ok = self.set_choice_config("pcsaveimgformat", &["JPEG Only", "JPEG"]);

        if let Some(quality) = self.get_choice_config_value("imagequality") {
            let lower = quality.to_ascii_lowercase();
            let is_raw = lower.contains("raw");
            let is_pure_raw = is_raw && !lower.contains("jpeg") && !lower.contains("jpg");
            if is_pure_raw || (is_raw && !pc_save_ok) {
                let _ = self.set_choice_config(
                    "imagequality",
                    &[
                        "Extra Fine",
                        "Fine",
                        "Large Fine JPEG",
                        "JPEG Fine",
                        "JPEG",
                        "Standard",
                        "Normal",
                    ],
                );
            }
        }
    }

    fn read_and_delete_file(&self, path: &CameraFilePath) -> Result<Vec<u8>, String> {
        let api = gphoto2_api()?;
        if self.camera.is_null() {
            return Err("libgphoto2 camera not connected".to_string());
        }

        unsafe {
            let mut file: *mut c_void = ptr::null_mut();
            let new_err = (api.file_new)(&mut file);
            if new_err < GP_OK || file.is_null() {
                return Err(format!("gp_file_new failed (code {})", new_err));
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
                    Some(std::slice::from_raw_parts(data_ptr as *const u8, size as usize).to_vec())
                } else {
                    Some(Vec::new())
                }
            } else {
                None
            };

            let _ = (api.camera_file_delete)(
                self.camera,
                path.folder.as_ptr(),
                path.name.as_ptr(),
                self.context,
            );
            let _ = (api.file_free)(file);

            bytes.ok_or_else(|| format!("gp_camera_file_get failed (code {})", get_err))
        }
    }

    fn drain_events_for_jpeg(&self, timeout: Duration, expect_image: bool) -> Option<Vec<u8>> {
        let Ok(api) = gphoto2_api() else {
            return None;
        };
        if self.camera.is_null() {
            return None;
        }

        let mut deadline = Instant::now() + timeout;
        loop {
            let now = Instant::now();
            if now >= deadline {
                return None;
            }
            // When draining (not expecting an image) wait the full window in one call so a
            // companion ARW that arrives a few hundred ms after the JPEG is still pulled off the
            // camera; left behind, it stays in Sony's buffer and freezes live view.
            let slice_cap = if expect_image { 200 } else { timeout.as_millis().min(1500) };
            let wait_ms = deadline
                .saturating_duration_since(now)
                .as_millis()
                .min(slice_cap) as c_int;
            if wait_ms <= 0 {
                return None;
            }

            let mut event_type: c_int = GP_EVENT_UNKNOWN;
            let mut event_data: *mut c_void = ptr::null_mut();
            let err = unsafe {
                (api.camera_wait_for_event)(
                    self.camera,
                    wait_ms,
                    &mut event_type,
                    &mut event_data,
                    self.context,
                )
            };

            if err < GP_OK {
                if !event_data.is_null() {
                    unsafe { free(event_data) };
                }
                return None;
            }

            if event_type == GP_EVENT_FILE_ADDED && !event_data.is_null() {
                let path = unsafe { (*(event_data as *const CameraFilePath)).clone() };
                unsafe { free(event_data) };

                let name = unsafe {
                    CStr::from_ptr(path.name.as_ptr())
                        .to_string_lossy()
                        .into_owned()
                };

                match self.read_and_delete_file(&path) {
                    Ok(bytes) => {
                        if expect_image && is_valid_jpeg(&bytes) {
                            // Clear any trailing companion object (e.g. RAW+JPEG's second file).
                            let _ = self.drain_events_for_jpeg(Duration::from_millis(1200), false);
                            return Some(bytes);
                        }
                        if expect_image {
                            log::warn!(
                                "libgphoto2 discarding non-JPEG event file '{}' ({} bytes)",
                                name,
                                bytes.len()
                            );
                            deadline = deadline.max(Instant::now() + Duration::from_millis(2500));
                        } else {
                            log::info!(
                                "libgphoto2 drained stale event file '{}' ({} bytes)",
                                name,
                                bytes.len()
                            );
                        }
                    }
                    Err(e) => {
                        log::warn!("libgphoto2 failed to read event file '{}': {}", name, e);
                    }
                }
                continue;
            }

            if !event_data.is_null() {
                unsafe { free(event_data) };
            }

            if !expect_image && event_type == GP_EVENT_TIMEOUT {
                return None;
            }
            let _ = GP_EVENT_FOLDER_ADDED;
            let _ = GP_EVENT_CAPTURE_COMPLETE;
        }
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
                static FAILS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
                let n = FAILS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if n == 1 || n % 30 == 0 {
                    log::warn!("libgphoto2 live view frame failed (code {}), {} failures so far", cap_err, n);
                }
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

    fn capture_sony_nonblocking(&self) -> Option<Result<Vec<u8>, String>> {
        // Only cameras exposing Sony's 'autofocus' and 'capture' toggles take Path A.
        if self.set_toggle_config("autofocus", 1).is_err() {
            return None;
        }

        std::thread::sleep(Duration::from_millis(150));
        let capture_res = self.set_toggle_config("capture", 1);
        if let Err(err) = capture_res {
            // Shutter was never pressed, so falling back to gp_camera_capture is safe.
            let _ = self.set_toggle_config("autofocus", 0);
            log::warn!("libgphoto2 Sony capture toggle failed: {}", err);
            return None;
        }

        std::thread::sleep(Duration::from_millis(100));
        let _ = self.set_toggle_config("capture", 0);
        let _ = self.set_toggle_config("autofocus", 0);

        match self.drain_events_for_jpeg(Duration::from_millis(10000), true) {
            Some(bytes) => {
                log::info!(
                    "libgphoto2 Sony non-blocking capture complete: {} bytes ({:.1} MB)",
                    bytes.len(),
                    bytes.len() as f64 / (1024.0 * 1024.0)
                );
                Some(Ok(bytes))
            }
            None => Some(Err(
                "libgphoto2 Sony capture timed out waiting for JPEG event".to_string()
            )),
        }
    }

    /// Trigger actual shutter capture and download the full-resolution JPEG.
    pub fn capture_still(&self) -> Result<Vec<u8>, String> {
        let api = gphoto2_api()?;
        if self.camera.is_null() {
            return Err("libgphoto2 camera not connected".to_string());
        }

        let _ = self.drain_events_for_jpeg(Duration::from_millis(100), false);

        let mut last_err = String::new();
        // The 'autofocus'/'capture' toggle path is opt-in only: with AF-S + focus priority the
        // short press often never fires, and it times out waiting for the JPEG. gp_camera_capture
        // lets libgphoto2's Sony driver handle half-press, focus wait and object download itself.
        let use_toggle_path = std::env::var("CHRONO_SONY_TOGGLE_CAPTURE").is_ok();
        if !use_toggle_path {
            // skip
        } else if let Some(sony_res) = self.capture_sony_nonblocking() {
            match sony_res {
                Ok(bytes) => return Ok(bytes),
                // The shutter WAS pressed. Falling back to gp_camera_capture here would fire
                // extra shots (that is what produced the bursts), so report the error instead.
                Err(err) => return Err(err),
            }
        }

        for attempt in 0..2 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_millis(250));
                let _ = self.drain_events_for_jpeg(Duration::from_millis(100), false);
            }

            let mut path: CameraFilePath = unsafe { std::mem::zeroed() };
            let cap_err = unsafe {
                (api.camera_capture)(self.camera, GP_CAPTURE_IMAGE, &mut path, self.context)
            };
            if cap_err < GP_OK {
                last_err = format!("gp_camera_capture failed (code {})", cap_err);
                continue;
            }

            match self.read_and_delete_file(&path) {
                Ok(bytes) if is_valid_jpeg(&bytes) => {
                    let _ = self.drain_events_for_jpeg(Duration::from_millis(1200), false);
                    log::info!(
                        "libgphoto2 capture complete: {} bytes ({:.1} MB)",
                        bytes.len(),
                        bytes.len() as f64 / (1024.0 * 1024.0)
                    );
                    return Ok(bytes);
                }
                Ok(bytes) => {
                    log::warn!(
                        "libgphoto2 capture returned non-JPEG ({} bytes); waiting for companion JPEG",
                        bytes.len()
                    );
                    if let Some(jpeg) = self.drain_events_for_jpeg(Duration::from_millis(3500), true)
                    {
                        log::info!(
                            "libgphoto2 companion JPEG capture complete: {} bytes ({:.1} MB)",
                            jpeg.len(),
                            jpeg.len() as f64 / (1024.0 * 1024.0)
                        );
                        return Ok(jpeg);
                    }
                    last_err = format!(
                        "libgphoto2 capture produced non-JPEG data ({} bytes)",
                        bytes.len()
                    );
                }
                Err(err) => {
                    last_err = err;
                }
            }
        }

        // Fallback to live view frame only if shutter capture failed after retry
        if let Ok(frame) = self.get_live_view_frame() {
            if is_valid_jpeg(&frame) {
                log::warn!(
                    "libgphoto2 shutter capture failed ({}); falling back to live view frame",
                    last_err
                );
                return Ok(frame);
            }
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

