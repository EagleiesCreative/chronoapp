/*
 * Canon EDSDK — Rust FFI Module
 *
 * Dynamically loads Canon's EOS Digital SDK (EDSDK.framework on macOS) at
 * runtime via libloading and exposes a small, safe-ish wrapper that mirrors
 * the Sony bridge in sony.rs:
 *
 *   - CanonSdk::load()      → initialise the SDK once (global, never re-init)
 *   - CanonSdk::list_cameras()
 *   - CanonSession          → an open camera session with live view + capture
 *
 * IMPORTANT threading note: EDSDK is single-threaded and event-driven. Every
 * EDSDK call in this app happens on the dedicated camera thread (see
 * camera.rs). Object events (image-transfer notifications after a shot) are
 * delivered only while EdsGetEvent() is being pumped on that same thread.
 *
 * The EDSDK.framework is NOT bundled — it must be placed at
 * src-tauri/libs/EDSDK.framework (Canon Developer Program license required).
 * When it is absent, load() returns Err and Canon support is disabled while
 * system + Sony cameras keep working.
 */

use libloading::Library;
use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_void, CStr};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/* ----------------------------------------------------------------
 * EDSDK typedefs & constants (mirror EDSDK.h)
 * ---------------------------------------------------------------- */

pub type EdsError = u32;
pub type EdsBaseRef = *mut c_void;
pub type EdsCameraListRef = EdsBaseRef;
pub type EdsCameraRef = EdsBaseRef;
pub type EdsStreamRef = EdsBaseRef;
pub type EdsEvfImageRef = EdsBaseRef;
pub type EdsDirectoryItemRef = EdsBaseRef;

pub const EDS_ERR_OK: EdsError = 0x0000_0000;

// Camera commands
const K_EDS_CAMERA_COMMAND_TAKE_PICTURE: u32 = 0x0000_0000;
const K_EDS_CAMERA_COMMAND_PRESS_SHUTTER: u32 = 0x0000_0004;
const K_EDS_SHUTTER_COMPLETELY: i32 = 0x0000_0003;
const K_EDS_SHUTTER_OFF: i32 = 0x0000_0000;

// Property IDs
const K_EDS_PROP_ID_SAVE_TO: u32 = 0x0000_000b;
const K_EDS_PROP_ID_EVF_OUTPUT_DEVICE: u32 = 0x0000_0500;

// Property values
const K_EDS_SAVE_TO_HOST: u32 = 2;
const K_EDS_EVF_OUTPUT_DEVICE_PC: u32 = 2;

// Object events
const K_EDS_OBJECT_EVENT_ALL: u32 = 0x0000_0200;
const K_EDS_OBJECT_EVENT_DIR_ITEM_REQUEST_TRANSFER: u32 = 0x0000_0208;
const K_EDS_OBJECT_EVENT_DIR_ITEM_CREATED: u32 = 0x0000_0204;

const EDS_MAX_NAME: usize = 256;

/* ----------------------------------------------------------------
 * EDSDK structs (mirror EDSDK.h; #[repr(C)])
 * ---------------------------------------------------------------- */

#[repr(C)]
#[derive(Clone)]
pub struct EdsDeviceInfo {
    pub sz_port_name: [c_char; EDS_MAX_NAME],
    pub sz_device_description: [c_char; EDS_MAX_NAME],
    pub device_sub_type: u32,
    pub reserved: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct EdsCapacity {
    pub number_of_free_clusters: i32,
    pub bytes_per_sector: i32,
    pub reset: i32,
}

// NOTE: Modern EDSDK (v3.x/13.x, required for current EOS bodies on Apple
// silicon) uses a 64-bit `size` field here. If you build against a legacy
// EDSDK where `size` is EdsUInt32, change `size` to u32 and add 4 bytes of
// padding to keep the following fields aligned.
#[repr(C)]
#[derive(Clone)]
pub struct EdsDirectoryItemInfo {
    pub size: u64,
    pub is_folder: i32,
    pub group_id: u32,
    pub option: u32,
    pub sz_file_name: [c_char; EDS_MAX_NAME],
    pub format: u32,
    pub date_time: u32,
}

/* ----------------------------------------------------------------
 * Public Rust type returned to the frontend
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonCameraInfo {
    pub id: String,
    pub name: String,
}

/* ----------------------------------------------------------------
 * Resolved EDSDK function table (raw C fn pointers).
 *
 * Function pointers are Copy + Send + Sync. They stay valid for as long as
 * the underlying dylib remains mapped, which we guarantee by storing the
 * Library in a 'static OnceLock (never dropped → never dlclose'd).
 * ---------------------------------------------------------------- */

type EdsObjectEventHandler =
    unsafe extern "C" fn(event: u32, in_ref: EdsBaseRef, context: *mut c_void) -> EdsError;

#[allow(clippy::type_complexity)]
struct CanonApi {
    initialize_sdk: unsafe extern "C" fn() -> EdsError,
    get_camera_list: unsafe extern "C" fn(*mut EdsCameraListRef) -> EdsError,
    get_child_count: unsafe extern "C" fn(EdsBaseRef, *mut u32) -> EdsError,
    get_child_at_index: unsafe extern "C" fn(EdsBaseRef, i32, *mut EdsBaseRef) -> EdsError,
    get_device_info: unsafe extern "C" fn(EdsCameraRef, *mut EdsDeviceInfo) -> EdsError,
    open_session: unsafe extern "C" fn(EdsCameraRef) -> EdsError,
    close_session: unsafe extern "C" fn(EdsCameraRef) -> EdsError,
    release: unsafe extern "C" fn(EdsBaseRef) -> EdsError,
    set_property_data: unsafe extern "C" fn(EdsBaseRef, u32, i32, u32, *const c_void) -> EdsError,
    send_command: unsafe extern "C" fn(EdsCameraRef, u32, i32) -> EdsError,
    set_capacity: unsafe extern "C" fn(EdsCameraRef, EdsCapacity) -> EdsError,
    set_object_event_handler:
        unsafe extern "C" fn(EdsCameraRef, u32, EdsObjectEventHandler, *mut c_void) -> EdsError,
    create_memory_stream: unsafe extern "C" fn(u64, *mut EdsStreamRef) -> EdsError,
    create_evf_image_ref: unsafe extern "C" fn(EdsStreamRef, *mut EdsEvfImageRef) -> EdsError,
    download_evf_image: unsafe extern "C" fn(EdsCameraRef, EdsEvfImageRef) -> EdsError,
    get_pointer: unsafe extern "C" fn(EdsStreamRef, *mut *mut c_void) -> EdsError,
    get_length: unsafe extern "C" fn(EdsStreamRef, *mut u64) -> EdsError,
    get_directory_item_info:
        unsafe extern "C" fn(EdsDirectoryItemRef, *mut EdsDirectoryItemInfo) -> EdsError,
    download: unsafe extern "C" fn(EdsDirectoryItemRef, u64, EdsStreamRef) -> EdsError,
    download_complete: unsafe extern "C" fn(EdsDirectoryItemRef) -> EdsError,
    get_event: unsafe extern "C" fn() -> EdsError,
}

static CANON_LIB: OnceLock<Library> = OnceLock::new();
static CANON_API: OnceLock<CanonApi> = OnceLock::new();
static INIT_DONE: AtomicBool = AtomicBool::new(false);

// Filled in by the object-event handler when a freshly shot image is ready to
// download. Only ever touched on the camera thread, but a Mutex keeps it sound.
static CAPTURE_BUFFER: Mutex<Option<Vec<u8>>> = Mutex::new(None);

fn canon_api() -> Result<&'static CanonApi, String> {
    CANON_API
        .get()
        .ok_or_else(|| "Canon EDSDK not initialised".to_string())
}

/* ----------------------------------------------------------------
 * Object-event handler — runs during EdsGetEvent() pumping.
 * Downloads the captured image into CAPTURE_BUFFER.
 * ---------------------------------------------------------------- */

unsafe extern "C" fn object_event_handler(
    event: u32,
    in_ref: EdsBaseRef,
    _context: *mut c_void,
) -> EdsError {
    // With SaveTo=Host the body fires DirItemRequestTransfer when the image is
    // ready to pull. We deliberately ignore DirItemCreated to avoid downloading
    // the same full-res file twice.
    let _ = K_EDS_OBJECT_EVENT_DIR_ITEM_CREATED;
    if event == K_EDS_OBJECT_EVENT_DIR_ITEM_REQUEST_TRANSFER {
        if let Some(api) = CANON_API.get() {
            let mut info: EdsDirectoryItemInfo = std::mem::zeroed();
            if (api.get_directory_item_info)(in_ref, &mut info) == EDS_ERR_OK && info.size > 0 {
                let mut stream: EdsStreamRef = ptr::null_mut();
                if (api.create_memory_stream)(info.size, &mut stream) == EDS_ERR_OK
                    && !stream.is_null()
                {
                    if (api.download)(in_ref, info.size, stream) == EDS_ERR_OK {
                        (api.download_complete)(in_ref);

                        let mut data_ptr: *mut c_void = ptr::null_mut();
                        let mut len: u64 = 0;
                        (api.get_pointer)(stream, &mut data_ptr);
                        (api.get_length)(stream, &mut len);

                        if !data_ptr.is_null() && len > 0 {
                            let bytes =
                                std::slice::from_raw_parts(data_ptr as *const u8, len as usize)
                                    .to_vec();
                            if let Ok(mut guard) = CAPTURE_BUFFER.lock() {
                                *guard = Some(bytes);
                            }
                        }
                    }
                    (api.release)(stream);
                }
            }
        }
        // Always release the directory item ref handed to us by the SDK.
        if let Some(api) = CANON_API.get() {
            (api.release)(in_ref);
        }
    }
    EDS_ERR_OK
}

/* ----------------------------------------------------------------
 * Canon SDK wrapper (zero-sized; all real state lives in the statics above)
 * ---------------------------------------------------------------- */

/// Find the EDSDK library, whether running from `src-tauri` in dev or from
/// inside a packaged `.app` (framework bundled into Contents/Frameworks).
fn edsdk_library_path() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    let candidates: Vec<PathBuf> = if cfg!(target_os = "macos") {
        let rel = "EDSDK.framework/Versions/A/EDSDK";
        let mut v = vec![PathBuf::from("libs").join(rel)]; // dev: cwd = src-tauri
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                v.push(dir.join("../Frameworks").join(rel)); // bundled .app
                v.push(dir.join("libs").join(rel));
            }
        }
        v
    } else if cfg!(target_os = "windows") {
        let mut v = vec![PathBuf::from("libs/EDSDK.dll"), PathBuf::from("EDSDK.dll")];
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                v.push(dir.join("EDSDK.dll"));
                v.push(dir.join("libs/EDSDK.dll"));
            }
        }
        v
    } else {
        Vec::new()
    };

    candidates.into_iter().find(|p| p.exists())
}

pub struct CanonSdk;

impl CanonSdk {
    /// Load and initialise EDSDK exactly once. Cheap no-op on later calls.
    pub fn load() -> Result<Self, String> {
        if INIT_DONE.load(Ordering::Acquire) && CANON_API.get().is_some() {
            return Ok(Self);
        }

        let lib_path = edsdk_library_path().ok_or_else(|| {
            "EDSDK not found. Place Canon's EDSDK.framework in src-tauri/libs/ (dev) \
             or bundle it into the app's Frameworks folder."
                .to_string()
        })?;

        unsafe {
            let lib = Library::new(&lib_path)
                .map_err(|e| format!("Failed to load EDSDK from {:?}: {}", lib_path, e))?;

            // Resolve every symbol we need up front. `*` copies the raw fn
            // pointer out of the libloading Symbol; it stays valid because the
            // Library is kept alive for the whole process below.
            macro_rules! sym {
                ($name:expr, $t:ty) => {{
                    let s = lib.get::<$t>($name).map_err(|e| {
                        format!(
                            "EDSDK symbol {} not found: {}",
                            String::from_utf8_lossy($name),
                            e
                        )
                    })?;
                    *s
                }};
            }

            let api = CanonApi {
                initialize_sdk: sym!(b"EdsInitializeSDK", unsafe extern "C" fn() -> EdsError),
                get_camera_list: sym!(
                    b"EdsGetCameraList",
                    unsafe extern "C" fn(*mut EdsCameraListRef) -> EdsError
                ),
                get_child_count: sym!(
                    b"EdsGetChildCount",
                    unsafe extern "C" fn(EdsBaseRef, *mut u32) -> EdsError
                ),
                get_child_at_index: sym!(
                    b"EdsGetChildAtIndex",
                    unsafe extern "C" fn(EdsBaseRef, i32, *mut EdsBaseRef) -> EdsError
                ),
                get_device_info: sym!(
                    b"EdsGetDeviceInfo",
                    unsafe extern "C" fn(EdsCameraRef, *mut EdsDeviceInfo) -> EdsError
                ),
                open_session: sym!(
                    b"EdsOpenSession",
                    unsafe extern "C" fn(EdsCameraRef) -> EdsError
                ),
                close_session: sym!(
                    b"EdsCloseSession",
                    unsafe extern "C" fn(EdsCameraRef) -> EdsError
                ),
                release: sym!(b"EdsRelease", unsafe extern "C" fn(EdsBaseRef) -> EdsError),
                set_property_data: sym!(
                    b"EdsSetPropertyData",
                    unsafe extern "C" fn(EdsBaseRef, u32, i32, u32, *const c_void) -> EdsError
                ),
                send_command: sym!(
                    b"EdsSendCommand",
                    unsafe extern "C" fn(EdsCameraRef, u32, i32) -> EdsError
                ),
                set_capacity: sym!(
                    b"EdsSetCapacity",
                    unsafe extern "C" fn(EdsCameraRef, EdsCapacity) -> EdsError
                ),
                set_object_event_handler: sym!(
                    b"EdsSetObjectEventHandler",
                    unsafe extern "C" fn(
                        EdsCameraRef,
                        u32,
                        EdsObjectEventHandler,
                        *mut c_void,
                    ) -> EdsError
                ),
                create_memory_stream: sym!(
                    b"EdsCreateMemoryStream",
                    unsafe extern "C" fn(u64, *mut EdsStreamRef) -> EdsError
                ),
                create_evf_image_ref: sym!(
                    b"EdsCreateEvfImageRef",
                    unsafe extern "C" fn(EdsStreamRef, *mut EdsEvfImageRef) -> EdsError
                ),
                download_evf_image: sym!(
                    b"EdsDownloadEvfImage",
                    unsafe extern "C" fn(EdsCameraRef, EdsEvfImageRef) -> EdsError
                ),
                get_pointer: sym!(
                    b"EdsGetPointer",
                    unsafe extern "C" fn(EdsStreamRef, *mut *mut c_void) -> EdsError
                ),
                get_length: sym!(
                    b"EdsGetLength",
                    unsafe extern "C" fn(EdsStreamRef, *mut u64) -> EdsError
                ),
                get_directory_item_info: sym!(
                    b"EdsGetDirectoryItemInfo",
                    unsafe extern "C" fn(EdsDirectoryItemRef, *mut EdsDirectoryItemInfo) -> EdsError
                ),
                download: sym!(
                    b"EdsDownload",
                    unsafe extern "C" fn(EdsDirectoryItemRef, u64, EdsStreamRef) -> EdsError
                ),
                download_complete: sym!(
                    b"EdsDownloadComplete",
                    unsafe extern "C" fn(EdsDirectoryItemRef) -> EdsError
                ),
                get_event: sym!(b"EdsGetEvent", unsafe extern "C" fn() -> EdsError),
            };

            let err = (api.initialize_sdk)();
            if err != EDS_ERR_OK {
                return Err(format!("EdsInitializeSDK failed: 0x{:08X}", err));
            }

            // Keep the library mapped forever and publish the resolved table.
            let _ = CANON_LIB.set(lib);
            let _ = CANON_API.set(api);
            INIT_DONE.store(true, Ordering::Release);

            log::info!("Canon EDSDK initialised successfully");
            Ok(Self)
        }
    }

    /// Enumerate connected Canon cameras with their real model names.
    pub fn list_cameras(&self) -> Result<Vec<CanonCameraInfo>, String> {
        let api = canon_api()?;
        unsafe {
            let mut list: EdsCameraListRef = ptr::null_mut();
            if (api.get_camera_list)(&mut list) != EDS_ERR_OK || list.is_null() {
                return Ok(Vec::new());
            }

            let mut count: u32 = 0;
            (api.get_child_count)(list, &mut count);

            let mut cameras = Vec::new();
            for i in 0..count {
                let mut cam: EdsCameraRef = ptr::null_mut();
                if (api.get_child_at_index)(list, i as i32, &mut cam) == EDS_ERR_OK
                    && !cam.is_null()
                {
                    let mut info: EdsDeviceInfo = std::mem::zeroed();
                    let name = if (api.get_device_info)(cam, &mut info) == EDS_ERR_OK {
                        let desc = CStr::from_ptr(info.sz_device_description.as_ptr())
                            .to_string_lossy()
                            .to_string();
                        if desc.is_empty() {
                            format!("Canon Camera {}", i + 1)
                        } else {
                            desc
                        }
                    } else {
                        format!("Canon Camera {}", i + 1)
                    };
                    cameras.push(CanonCameraInfo {
                        id: format!("canon_{}", i),
                        name,
                    });
                    (api.release)(cam);
                }
            }
            (api.release)(list);

            log::info!("Found {} Canon camera(s)", cameras.len());
            Ok(cameras)
        }
    }

    /// Open a session on the camera at the given EDSDK list index.
    pub fn connect(&self, index: u32) -> Result<CanonSession, String> {
        let api = canon_api()?;
        unsafe {
            let mut list: EdsCameraListRef = ptr::null_mut();
            let e = (api.get_camera_list)(&mut list);
            if e != EDS_ERR_OK || list.is_null() {
                return Err(format!("EdsGetCameraList failed: 0x{:08X}", e));
            }

            let mut count: u32 = 0;
            (api.get_child_count)(list, &mut count);
            if index >= count {
                (api.release)(list);
                return Err(format!(
                    "Canon camera index {} out of range ({} connected)",
                    index, count
                ));
            }

            let mut camera: EdsCameraRef = ptr::null_mut();
            let e = (api.get_child_at_index)(list, index as i32, &mut camera);
            (api.release)(list);
            if e != EDS_ERR_OK || camera.is_null() {
                return Err(format!("EdsGetChildAtIndex failed: 0x{:08X}", e));
            }

            let e = (api.open_session)(camera);
            if e != EDS_ERR_OK {
                (api.release)(camera);
                return Err(format!("EdsOpenSession failed: 0x{:08X}", e));
            }

            // Route shots to the host (PC), not the SD card.
            let save_to: u32 = K_EDS_SAVE_TO_HOST;
            (api.set_property_data)(
                camera,
                K_EDS_PROP_ID_SAVE_TO,
                0,
                4,
                &save_to as *const u32 as *const c_void,
            );

            // Many bodies refuse to shoot-to-host unless a host capacity is set.
            let capacity = EdsCapacity {
                number_of_free_clusters: 0x7FFF_FFFF,
                bytes_per_sector: 0x1000,
                reset: 1,
            };
            (api.set_capacity)(camera, capacity);

            // Receive image-transfer notifications after each shot.
            (api.set_object_event_handler)(
                camera,
                K_EDS_OBJECT_EVENT_ALL,
                object_event_handler,
                ptr::null_mut(),
            );

            log::info!("Canon session opened (index {})", index);
            Ok(CanonSession { camera })
        }
    }
}

/* ----------------------------------------------------------------
 * Canon camera session — an open EdsCameraRef.
 *
 * Holds a raw pointer, so it is deliberately !Send. It must only ever be used
 * on the camera thread (the one that called CanonSdk::load()).
 * ---------------------------------------------------------------- */

pub struct CanonSession {
    camera: EdsCameraRef,
}

impl CanonSession {
    pub fn is_connected(&self) -> bool {
        !self.camera.is_null()
    }

    /// Pump one round of EDSDK events. Must be called regularly on the camera
    /// thread so object-transfer callbacks actually fire.
    pub fn pump_events(&self) {
        if let Ok(api) = canon_api() {
            unsafe {
                (api.get_event)();
            }
        }
    }

    /// Turn on PC live view (EVF output → computer).
    pub fn start_live_view(&self) -> Result<(), String> {
        let api = canon_api()?;
        unsafe {
            let device: u32 = K_EDS_EVF_OUTPUT_DEVICE_PC;
            let e = (api.set_property_data)(
                self.camera,
                K_EDS_PROP_ID_EVF_OUTPUT_DEVICE,
                0,
                4,
                &device as *const u32 as *const c_void,
            );
            if e != EDS_ERR_OK {
                return Err(format!("Failed to start Canon live view: 0x{:08X}", e));
            }
            Ok(())
        }
    }

    /// Turn off PC live view.
    pub fn stop_live_view(&self) -> Result<(), String> {
        let api = canon_api()?;
        unsafe {
            let device: u32 = 0; // kEdsEvfOutputDevice_None
            (api.set_property_data)(
                self.camera,
                K_EDS_PROP_ID_EVF_OUTPUT_DEVICE,
                0,
                4,
                &device as *const u32 as *const c_void,
            );
        }
        Ok(())
    }

    /// Grab one EVF live-view frame as JPEG bytes. Err if not ready yet.
    pub fn get_live_view_frame(&self) -> Result<Vec<u8>, String> {
        let api = canon_api()?;
        unsafe {
            let mut stream: EdsStreamRef = ptr::null_mut();
            if (api.create_memory_stream)(0, &mut stream) != EDS_ERR_OK || stream.is_null() {
                return Err("Failed to create EVF stream".to_string());
            }

            let mut evf: EdsEvfImageRef = ptr::null_mut();
            if (api.create_evf_image_ref)(stream, &mut evf) != EDS_ERR_OK || evf.is_null() {
                (api.release)(stream);
                return Err("Failed to create EVF image ref".to_string());
            }

            // Frequently returns "object not ready" between frames — treat any
            // non-OK result as "no frame available right now".
            let dl = (api.download_evf_image)(self.camera, evf);
            if dl != EDS_ERR_OK {
                (api.release)(evf);
                (api.release)(stream);
                return Err("EVF frame not ready".to_string());
            }

            let mut data_ptr: *mut c_void = ptr::null_mut();
            let mut len: u64 = 0;
            (api.get_pointer)(stream, &mut data_ptr);
            (api.get_length)(stream, &mut len);

            let out = if !data_ptr.is_null() && len > 0 {
                std::slice::from_raw_parts(data_ptr as *const u8, len as usize).to_vec()
            } else {
                Vec::new()
            };

            (api.release)(evf);
            (api.release)(stream);

            if out.is_empty() {
                return Err("Empty EVF frame".to_string());
            }
            Ok(out)
        }
    }

    /// Trigger the shutter and return the full-resolution JPEG.
    ///
    /// EDSDK delivers the image asynchronously via the object-event handler, so
    /// after firing we pump EdsGetEvent() until CAPTURE_BUFFER is filled.
    pub fn capture_still(&self) -> Result<Vec<u8>, String> {
        let api = canon_api()?;

        // Clear any stale frame before shooting.
        if let Ok(mut guard) = CAPTURE_BUFFER.lock() {
            *guard = None;
        }

        unsafe {
            let mut err =
                (api.send_command)(self.camera, K_EDS_CAMERA_COMMAND_TAKE_PICTURE, 0);

            // Some bodies reject the legacy TakePicture command and need an
            // explicit shutter-button press/release instead.
            if err != EDS_ERR_OK {
                let press = (api.send_command)(
                    self.camera,
                    K_EDS_CAMERA_COMMAND_PRESS_SHUTTER,
                    K_EDS_SHUTTER_COMPLETELY,
                );
                (api.send_command)(
                    self.camera,
                    K_EDS_CAMERA_COMMAND_PRESS_SHUTTER,
                    K_EDS_SHUTTER_OFF,
                );
                if press != EDS_ERR_OK {
                    return Err(format!("Canon shutter release failed: 0x{:08X}", err));
                }
                err = EDS_ERR_OK;
            }
            let _ = err;

            // Wait for the image to arrive (AF + exposure + USB transfer).
            let start = Instant::now();
            loop {
                (api.get_event)();

                if let Ok(mut guard) = CAPTURE_BUFFER.lock() {
                    if let Some(bytes) = guard.take() {
                        log::info!(
                            "Canon capture complete: {} bytes ({:.1} MB)",
                            bytes.len(),
                            bytes.len() as f64 / (1024.0 * 1024.0)
                        );
                        return Ok(bytes);
                    }
                }

                if start.elapsed() > Duration::from_secs(20) {
                    return Err("Canon capture timed out waiting for image transfer".to_string());
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

impl Drop for CanonSession {
    fn drop(&mut self) {
        if let Ok(api) = canon_api() {
            unsafe {
                if !self.camera.is_null() {
                    // Best-effort: turn live view off, close the session, release.
                    let device: u32 = 0;
                    (api.set_property_data)(
                        self.camera,
                        K_EDS_PROP_ID_EVF_OUTPUT_DEVICE,
                        0,
                        4,
                        &device as *const u32 as *const c_void,
                    );
                    (api.close_session)(self.camera);
                    (api.release)(self.camera);
                }
            }
        }
        self.camera = ptr::null_mut();
        log::info!("Canon session closed");
    }
}
