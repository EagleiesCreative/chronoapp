use base64::{engine::general_purpose::STANDARD, Engine};
use nokhwa::{
    pixel_format::RgbFormat,
    utils::{CameraIndex, RequestedFormat, RequestedFormatType, Resolution},
    Camera,
};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::sync::mpsc::{self, Sender, Receiver};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use crate::canon::{CanonSdk, CanonSession};
use crate::gphoto2::{GPhoto2Sdk, GPhoto2Session};
use crate::sony::SonySdk;
use tauri::State;


/// A capture request that waited longer than this in the queue is dropped instead of fired:
/// the frontend (20s timeout) has already given up on it and sent a retry.
const STALE_CAPTURE_AFTER: Duration = Duration::from_secs(12);
/// With no live-view viewer, the camera gets no USB traffic and Sony bodies drift into a
/// power-save state; the next shutter then takes 30–40s. Touch the camera this often to keep it awake.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(20);

/// Messages sent to the camera thread
enum CameraCommand {
    Start { device_id: String, is_canon: bool, is_sony: bool, is_gphoto2: bool, requested_at: Instant, reply: Sender<Result<CameraStatus, String>> },
    Stop { reply: Sender<Result<(), String>> },
    Capture { quality: u8, reply: Sender<Result<String, String>> },
    GetStatus { reply: Sender<Result<CameraStatus, String>> },
    /// Sony-specific: trigger actual shutter release and return full-res image
    SonyCapture { _quality: u8, requested_at: Instant, reply: Sender<Result<String, String>> },
    /// Canon-specific: trigger actual shutter release and return full-res image
    CanonCapture { _quality: u8, requested_at: Instant, reply: Sender<Result<String, String>> },
    /// Enumerate Canon cameras on the camera thread (EDSDK is single-threaded)
    ListCanon { reply: Sender<Result<Vec<CameraDevice>, String>> },
    /// Enumerate Sony cameras on the camera thread (CrSDK is a process-wide singleton)
    ListSony { reply: Sender<Result<Vec<CameraDevice>, String>> },
    /// Enumerate USB cameras via libgphoto2 (Sony A7R III, Canon 80D, etc.)
    ListGPhoto2 { reply: Sender<Result<Vec<CameraDevice>, String>> },
}


/// Camera state managed by Tauri - holds a channel to the camera thread
pub struct CameraState {
    sender: Mutex<Option<Sender<CameraCommand>>>,
    frame_tx: crossbeam_channel::Sender<Vec<u8>>,
}

impl CameraState {
    pub fn new(frame_tx: crossbeam_channel::Sender<Vec<u8>>) -> Self {
        Self {
            sender: Mutex::new(None),
            frame_tx,
        }
    }
}

/// Camera device info returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraDevice {
    pub id: String,
    pub name: String,
}

/// Camera status info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraStatus {
    pub is_active: bool,
    pub device_name: Option<String>,
    pub resolution: Option<(u32, u32)>,
}

struct CameraSdks {
    canon: Option<CanonSdk>,
    sony: Option<SonySdk>,
    gphoto2: Option<GPhoto2Sdk>,
}

#[derive(Default)]
struct ActiveCameraState<'a> {
    camera: Option<Camera>,
    is_canon_active: bool,
    is_sony_active: bool,
    is_gphoto2_active: bool,
    sony_session: Option<crate::sony::SonySession<'a>>,
    canon_session: Option<CanonSession>,
    gphoto2_session: Option<GPhoto2Session>,
    active_device_id: Option<String>,
    last_backend_device_id: Option<String>,
    cached_sony_devices: Vec<CameraDevice>,
    /// (device_id, finished_at, error) of the last failed Start. Used to drop Start
    /// requests that queued up while that (slow) attempt was still blocking.
    last_start_failure: Option<(String, Instant, String)>,
}

impl<'a> ActiveCameraState<'a> {
    fn has_active_stream(&self) -> bool {
        self.camera.is_some()
            || self.is_canon_active
            || self.is_sony_active
            || self.is_gphoto2_active
    }

    /// Stop and release whichever camera backend is currently active.
    /// Returns true if an SDK session (Sony/Canon/gphoto2) was active.
    fn stop_active(&mut self) -> bool {
        self.active_device_id = None;
        if let Some(mut cam) = self.camera.take() {
            cam.stop_stream().ok();
        }
        let had_sdk_session = self.sony_session.is_some()
            || self.canon_session.is_some()
            || self.gphoto2_session.is_some();

        if self.is_sony_active {
            if let Some(ref session) = self.sony_session {
                session.stop_live_view().ok();
            }
        }
        if self.is_canon_active {
            if let Some(ref session) = self.canon_session {
                session.stop_live_view().ok();
            }
        }

        self.sony_session = None;
        self.is_sony_active = false;
        self.canon_session = None;
        self.is_canon_active = false;
        self.gphoto2_session = None;
        self.is_gphoto2_active = false;
        had_sdk_session
    }

    fn broadcast_frame(&mut self, frame_tx: &crossbeam_channel::Sender<Vec<u8>>) {
        // Keep EDSDK event pumping active even when no /stream client is reading.
        if self.is_canon_active {
            if let Some(ref session) = self.canon_session {
                session.pump_events();
            }
        }

        // Skip capturing/JPEG-encoding frames when no /stream consumer is draining the channel.
        if frame_tx.is_full() {
            return;
        }

        if let Some(cam) = self.camera.as_mut() {
            if let Ok(frame) = cam.frame() {
                if let Ok(img) = frame.decode_image::<RgbFormat>() {
                    let mut jpeg_buffer = Cursor::new(Vec::new());
                    if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buffer, 60)
                        .encode_image(&img)
                        .is_ok()
                    {
                        let _ = frame_tx.try_send(jpeg_buffer.into_inner());
                    }
                }
            }
        } else if self.is_sony_active {
            if let Some(ref session) = self.sony_session {
                if let Ok(frame_data) = session.get_live_view_frame() {
                    let _ = frame_tx.try_send(frame_data);
                }
            }
        } else if self.is_canon_active {
            if let Some(ref session) = self.canon_session {
                if let Ok(frame_data) = session.get_live_view_frame() {
                    let _ = frame_tx.try_send(frame_data);
                }
            }
        } else if self.is_gphoto2_active {
            if let Some(ref session) = self.gphoto2_session {
                if let Ok(frame_data) = session.get_live_view_frame() {
                    let _ = frame_tx.try_send(frame_data);
                }
            }
        }
    }

    fn start_backend_device(
        &mut self,
        sdks: &'a CameraSdks,
        device_id: &str,
        is_canon: bool,
        is_sony: bool,
        is_gphoto2: bool,
    ) -> Result<CameraStatus, String> {
        if is_gphoto2 {
            let sdk = sdks
                .gphoto2
                .as_ref()
                .ok_or_else(|| "libgphoto2 not loaded. Install via `brew install gphoto2`.".to_string())?;
            let idx: u32 = device_id
                .strip_prefix("gphoto2_")
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);
            let session = sdk.connect(idx)?;
            self.is_gphoto2_active = true;
            self.gphoto2_session = Some(session);
            Ok(CameraStatus {
                is_active: true,
                device_name: Some(format!("USB Camera ({})", device_id)),
                resolution: Some((6000, 4000)),
            })
        } else if is_sony {
            let sdk = sdks
                .sony
                .as_ref()
                .ok_or_else(|| "Sony SDK not loaded. Place libsony_bridge.dylib in libs/".to_string())?;
            let idx: u32 = device_id
                .strip_prefix("sony_")
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);
            let session = sdk.connect(idx)?;
            session.start_live_view().ok();
            self.is_sony_active = true;
            self.sony_session = Some(session);
            Ok(CameraStatus {
                is_active: true,
                device_name: Some(format!("Sony Camera ({})", device_id)),
                resolution: Some((6000, 4000)),
            })
        } else if is_canon {
            let sdk = sdks
                .canon
                .as_ref()
                .ok_or_else(|| "Canon EDSDK not loaded. Place EDSDK.framework in libs/".to_string())?;
            let idx: u32 = device_id
                .strip_prefix("canon_")
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);
            let session = sdk.connect(idx)?;
            session.start_live_view().ok();
            self.is_canon_active = true;
            self.canon_session = Some(session);
            Ok(CameraStatus {
                is_active: true,
                device_name: Some(format!("Canon Camera ({})", device_id)),
                resolution: Some((6000, 4000)),
            })
        } else {
            Err(format!("Unsupported backend camera id: {}", device_id))
        }
    }

    fn discover_backend_device_id(
        &self,
        sdks: &'a CameraSdks,
        prefer_canon: bool,
    ) -> Option<String> {
        if prefer_canon {
            if let Some(id) = sdks
                .canon
                .as_ref()
                .and_then(|sdk| sdk.list_cameras().ok())
                .and_then(|list| list.into_iter().next().map(|c| c.id))
            {
                return Some(id);
            }
            if let Some(id) = sdks
                .gphoto2
                .as_ref()
                .and_then(|sdk| sdk.list_cameras().ok())
                .and_then(|list| list.into_iter().next().map(|c| c.id))
            {
                return Some(id);
            }
            None
        } else {
            if let Some(id) = sdks
                .gphoto2
                .as_ref()
                .and_then(|sdk| sdk.list_cameras().ok())
                .and_then(|list| list.into_iter().next().map(|c| c.id))
            {
                return Some(id);
            }
            if let Some(dev) = self.cached_sony_devices.first() {
                return Some(dev.id.clone());
            }
            sdks.sony
                .as_ref()
                .and_then(|sdk| sdk.list_cameras().ok())
                .and_then(|list| list.into_iter().next().map(|c| c.id))
        }
    }

    fn ensure_backend_session(
        &mut self,
        sdks: &'a CameraSdks,
        prefer_canon: bool,
    ) -> Result<(), String> {
        let already_connected = (self.is_gphoto2_active
            && self
                .gphoto2_session
                .as_ref()
                .is_some_and(|s| s.is_connected()))
            || (self.is_sony_active && self.sony_session.is_some())
            || (self.is_canon_active && self.canon_session.is_some());
        if already_connected {
            return Ok(());
        }

        let target_id = self
            .last_backend_device_id
            .clone()
            .or_else(|| self.discover_backend_device_id(sdks, prefer_canon))
            .ok_or_else(|| {
                if prefer_canon {
                    "Canon camera not connected".to_string()
                } else {
                    "Sony camera not connected".to_string()
                }
            })?;

        let is_gphoto2 = target_id.starts_with("gphoto2_");
        let is_canon = !is_gphoto2 && (target_id.starts_with("canon_") || prefer_canon);
        let is_sony = !is_gphoto2 && !is_canon;

        if self.stop_active() {
            std::thread::sleep(Duration::from_millis(150));
        }

        self.start_backend_device(sdks, &target_id, is_canon, is_sony, is_gphoto2)?;
        self.active_device_id = Some(target_id.clone());
        self.last_backend_device_id = Some(target_id.clone());
        log::info!("Auto-reconnected backend camera session for {}", target_id);
        Ok(())
    }

    fn encode_validated_jpeg(label: &str, image_data: &[u8]) -> Result<String, String> {
        if image_data.len() < 128 || !image_data.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Err(format!(
                "{} camera returned invalid JPEG data ({} bytes)",
                label,
                image_data.len()
            ));
        }
        let base64_data = STANDARD.encode(image_data);
        Ok(format!("data:image/jpeg;base64,{}", base64_data))
    }

    fn capture_backend_still(
        &mut self,
        sdks: &'a CameraSdks,
        prefer_canon: bool,
    ) -> Result<String, String> {
        self.ensure_backend_session(sdks, prefer_canon)?;

        if self.is_gphoto2_active {
            let session = self
                .gphoto2_session
                .as_ref()
                .ok_or_else(|| "gphoto2 camera not connected".to_string())?;
            let image_data = session
                .capture_still()
                .map_err(|e| format!("gphoto2 shutter release failed: {}", e))?;
            Self::encode_validated_jpeg("gphoto2", &image_data)
        } else if !prefer_canon || self.is_sony_active {
            if let Some(ref session) = self.sony_session {
                let image_data = session
                    .capture_still()
                    .map_err(|e| format!("Sony shutter release failed: {}", e))?;
                return Self::encode_validated_jpeg("Sony", &image_data);
            }
            if let Some(ref session) = self.canon_session {
                let image_data = session
                    .capture_still()
                    .map_err(|e| format!("Canon shutter release failed: {}", e))?;
                return Self::encode_validated_jpeg("Canon", &image_data);
            }
            Err("Sony camera not connected".to_string())
        } else {
            let session = self
                .canon_session
                .as_ref()
                .ok_or_else(|| "Canon camera not connected".to_string())?;
            let image_data = session
                .capture_still()
                .map_err(|e| format!("Canon shutter release failed: {}", e))?;
            Self::encode_validated_jpeg("Canon", &image_data)
        }
    }

    fn handle_command(&mut self, sdks: &'a CameraSdks, cmd: CameraCommand) {
        match cmd {
            CameraCommand::Start { device_id, is_canon, is_sony, is_gphoto2, requested_at, reply } => {
                let started_at = Instant::now();
                let already_active = self.active_device_id.as_deref() == Some(device_id.as_str())
                    && ((is_sony && self.is_sony_active && self.sony_session.is_some())
                        || (is_canon && self.is_canon_active && self.canon_session.is_some())
                        || (is_gphoto2 && self.is_gphoto2_active && self.gphoto2_session.is_some())
                        || (!is_sony && !is_canon && !is_gphoto2 && self.camera.is_some()));

                if already_active {
                    if is_canon || is_sony || is_gphoto2 {
                        self.last_backend_device_id = Some(device_id.clone());
                    }
                    log::info!("Reusing active camera session for {}", device_id);
                    reply.send(Ok(CameraStatus {
                        is_active: true,
                        device_name: Some(format!("Camera ({})", device_id)),
                        resolution: if is_sony || is_canon || is_gphoto2 { Some((6000, 4000)) } else { None },
                    })).ok();
                    return;
                }

                // A Start that was requested while a previous Start for the same device was
                // still blocking (e.g. gp_camera_init timing out) must not re-run the whole
                // handshake again — that is what stacked up multiple 50s stalls.
                if let Some((failed_id, failed_at, failed_err)) = &self.last_start_failure {
                    if failed_id == &device_id && requested_at < *failed_at {
                        log::warn!(
                            "Skipping stale Start({}) queued during previous failed attempt",
                            device_id
                        );
                        reply.send(Err(failed_err.clone())).ok();
                        return;
                    }
                }

                if self.stop_active() {
                    std::thread::sleep(Duration::from_millis(150));
                }

                let result = (|| -> Result<CameraStatus, String> {
                    if is_gphoto2 || is_sony || is_canon {
                        self.start_backend_device(sdks, &device_id, is_canon, is_sony, is_gphoto2)
                    } else {
                        let idx: u32 = device_id.parse().unwrap_or(0);
                        let index = CameraIndex::Index(idx);

                        let requested = RequestedFormat::new::<RgbFormat>(
                            RequestedFormatType::HighestResolution(Resolution::new(1920, 1080))
                        );

                        let mut cam = Camera::new(index, requested)
                            .map_err(|e| format!("Failed to create camera: {}", e))?;

                        cam.open_stream()
                            .map_err(|e| format!("Failed to open camera stream: {}", e))?;

                        let resolution = cam.resolution();
                        let device_name = cam.info().human_name().to_string();

                        let status = CameraStatus {
                            is_active: true,
                            device_name: Some(device_name),
                            resolution: Some((resolution.width(), resolution.height())),
                        };

                        self.camera = Some(cam);
                        Ok(status)
                    }
                })();

                log::info!(
                    "Start({}) finished in {:?} (ok={})",
                    device_id,
                    started_at.elapsed(),
                    result.is_ok()
                );

                if let Err(ref err) = result {
                    log::error!("Start({}) failed: {}", device_id, err);
                    self.last_start_failure = Some((device_id.clone(), Instant::now(), err.clone()));
                } else {
                    self.last_start_failure = None;
                    if is_canon || is_sony || is_gphoto2 {
                        self.last_backend_device_id = Some(device_id.clone());
                    } else {
                        self.last_backend_device_id = None;
                    }
                    self.active_device_id = Some(device_id);
                }
                reply.send(result).ok();
            }

            CameraCommand::Stop { reply } => {
                self.stop_active();
                reply.send(Ok(())).ok();
            }

            CameraCommand::Capture { quality, reply } => {
                let result = (|| -> Result<String, String> {
                    if self.is_gphoto2_active {
                        if let Some(ref session) = self.gphoto2_session {
                            let frame_data = session.get_live_view_frame()
                                .map_err(|e| format!("gphoto2 preview frame error: {}", e))?;
                            let base64_data = STANDARD.encode(&frame_data);
                            Ok(format!("data:image/jpeg;base64,{}", base64_data))
                        } else {
                            Err("gphoto2 session not active".to_string())
                        }
                    } else if self.is_sony_active {
                        if let Some(ref session) = self.sony_session {
                            let frame_data = session.get_live_view_frame()
                                .map_err(|e| format!("Sony preview frame error: {}", e))?;
                            let base64_data = STANDARD.encode(&frame_data);
                            Ok(format!("data:image/jpeg;base64,{}", base64_data))
                        } else {
                            Err("Sony session not active".to_string())
                        }
                    } else if self.is_canon_active {
                        if let Some(ref session) = self.canon_session {
                            let frame_data = session.get_live_view_frame()
                                .map_err(|e| format!("Canon preview frame error: {}", e))?;
                            let base64_data = STANDARD.encode(&frame_data);
                            Ok(format!("data:image/jpeg;base64,{}", base64_data))
                        } else {
                            Err("Canon session not active".to_string())
                        }
                    } else if let Some(cam) = self.camera.as_mut() {
                        let frame = cam.frame()
                            .map_err(|e| format!("Failed to capture frame: {}", e))?;
                        let img = frame.decode_image::<RgbFormat>()
                            .map_err(|e| format!("Failed to decode frame: {}", e))?;

                        let mut jpeg_buffer = Cursor::new(Vec::new());
                        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buffer, quality)
                            .encode_image(&img)
                            .map_err(|e| format!("Failed to encode JPEG: {}", e))?;

                        let base64_data = STANDARD.encode(jpeg_buffer.into_inner());
                        Ok(format!("data:image/jpeg;base64,{}", base64_data))
                    } else {
                        Err("Camera not started".to_string())
                    }
                })();

                reply.send(result).ok();
            }

            CameraCommand::SonyCapture { _quality: _, requested_at, reply } => {
                // If this request sat in the queue behind a slow capture, the frontend has
                // already timed out and retried. Firing it now would take an extra, unwanted shot.
                if requested_at.elapsed() > STALE_CAPTURE_AFTER {
                    log::warn!("Dropping stale SonyCapture request (queued {:?})", requested_at.elapsed());
                    reply.send(Err("Capture request expired while camera was busy".to_string())).ok();
                    return;
                }
                let result = self.capture_backend_still(sdks, false);
                if let Err(ref err) = result {
                    log::error!("SonyCapture failed: {}", err);
                }
                reply.send(result).ok();
            }

            CameraCommand::CanonCapture { _quality: _, requested_at, reply } => {
                if requested_at.elapsed() > STALE_CAPTURE_AFTER {
                    log::warn!("Dropping stale CanonCapture request (queued {:?})", requested_at.elapsed());
                    reply.send(Err("Capture request expired while camera was busy".to_string())).ok();
                    return;
                }
                let result = self.capture_backend_still(sdks, true);
                if let Err(ref err) = result {
                    log::error!("CanonCapture failed: {}", err);
                }
                reply.send(result).ok();
            }

            CameraCommand::ListCanon { reply } => {
                let started_at = Instant::now();
                let result = match &sdks.canon {
                    Some(sdk) => sdk
                        .list_cameras()
                        .map(|list| {
                            list.into_iter()
                                .map(|c| CameraDevice {
                                    id: c.id,
                                    name: format!("{} (Canon SDK)", c.name),
                                })
                                .collect::<Vec<_>>()
                        }),
                    None => Ok(Vec::new()),
                };
                if started_at.elapsed() >= Duration::from_millis(500) {
                    log::info!("ListCanon completed in {:?}", started_at.elapsed());
                }
                reply.send(result).ok();
            }

            CameraCommand::ListSony { reply } => {
                let started_at = Instant::now();
                // Don't re-enumerate (which releases s_enum_info in sony_bridge)
                // while a Sony session is actively open.
                let result = if self.is_sony_active && !self.cached_sony_devices.is_empty() {
                    Ok(self.cached_sony_devices.clone())
                } else {
                    match &sdks.sony {
                        Some(sdk) => {
                            let res = sdk.list_cameras().map(|list| {
                                list.into_iter()
                                    .map(|c| CameraDevice {
                                        id: c.id,
                                        name: format!("{} (Sony SDK)", c.name),
                                    })
                                    .collect::<Vec<_>>()
                            });
                            if let Ok(ref devs) = res {
                                self.cached_sony_devices = devs.clone();
                            }
                            res
                        }
                        None => Ok(Vec::new()),
                    }
                };
                log::info!("ListSony completed in {:?}", started_at.elapsed());
                reply.send(result).ok();
            }

            CameraCommand::ListGPhoto2 { reply } => {
                let started_at = Instant::now();
                let result = match &sdks.gphoto2 {
                    Some(sdk) => sdk
                        .list_cameras()
                        .map(|list| {
                            list.into_iter()
                                .map(|c| {
                                    let suffix = if c.name.to_lowercase().contains("canon") {
                                        "(Canon SDK)"
                                    } else {
                                        "(Sony SDK)"
                                    };
                                    CameraDevice {
                                        id: c.id,
                                        name: format!("{} {}", c.name, suffix),
                                    }
                                })
                                .collect::<Vec<_>>()
                        }),
                    None => Ok(Vec::new()),
                };
                log::info!("ListGPhoto2 completed in {:?}", started_at.elapsed());
                reply.send(result).ok();
            }

            CameraCommand::GetStatus { reply } => {
                let status = if self.is_gphoto2_active {
                    let connected = self.gphoto2_session.as_ref().map_or(false, |s| s.is_connected());
                    CameraStatus {
                        is_active: connected,
                        device_name: Some("USB Camera (gphoto2)".to_string()),
                        resolution: Some((6000, 4000)),
                    }
                } else if self.is_sony_active {
                    let connected = self.sony_session.as_ref().map_or(false, |s| s.is_connected());
                    CameraStatus {
                        is_active: connected,
                        device_name: Some("Sony Camera".to_string()),
                        resolution: Some((6000, 4000)),
                    }
                } else if self.is_canon_active {
                    let connected = self.canon_session.as_ref().map_or(false, |s| s.is_connected());
                    CameraStatus {
                        is_active: connected,
                        device_name: Some("Canon Camera".to_string()),
                        resolution: Some((6000, 4000)),
                    }
                } else {
                    match &self.camera {
                        Some(cam) => {
                            let resolution = cam.resolution();
                            CameraStatus {
                                is_active: true,
                                device_name: Some(cam.info().human_name().to_string()),
                                resolution: Some((resolution.width(), resolution.height())),
                            }
                        }
                        None => CameraStatus {
                            is_active: false,
                            device_name: None,
                            resolution: None,
                        },
                    }
                };
                reply.send(Ok(status)).ok();
            }
        }
    }
}

/// Camera thread that owns the non-Send Camera
fn camera_thread(receiver: Receiver<CameraCommand>, frame_tx: crossbeam_channel::Sender<Vec<u8>>) {
    let sdk_load_start = Instant::now();
    let sdks = CameraSdks {
        canon: CanonSdk::load().ok(),
        sony: SonySdk::load().ok(),
        gphoto2: GPhoto2Sdk::load().ok(),
    };
    log::info!("Camera thread initialized SDKs in {:?}", sdk_load_start.elapsed());

    let mut cam_state = ActiveCameraState::default();
    let mut last_broadcast = Instant::now() - Duration::from_millis(33);
    let mut last_usb_activity = Instant::now();

    loop {
        let timeout = if cam_state.has_active_stream() {
            Duration::from_millis(33)
        } else {
            Duration::from_secs(1)
        };

        let first_cmd = match receiver.recv_timeout(timeout) {
            Ok(cmd) => Some(cmd),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        // Always execute incoming commands (and drain any queued commands) BEFORE
        // capturing/encoding a live-view frame so Start/Stop/Capture/List never stall.
        if let Some(cmd) = first_cmd {
            cam_state.handle_command(&sdks, cmd);
            while let Ok(next_cmd) = receiver.try_recv() {
                cam_state.handle_command(&sdks, next_cmd);
            }
        }

        if cam_state.has_active_stream() && last_broadcast.elapsed() >= Duration::from_millis(33) {
            last_broadcast = Instant::now();
            if !frame_tx.is_full() {
                last_usb_activity = Instant::now();
            }
            cam_state.broadcast_frame(&frame_tx);
        }

        // Keepalive: nobody is watching live view, so pull one preview frame occasionally.
        if last_usb_activity.elapsed() >= KEEPALIVE_INTERVAL {
            last_usb_activity = Instant::now();
            if let Some(ref session) = cam_state.gphoto2_session {
                if let Err(e) = session.get_live_view_frame() {
                    log::debug!("gphoto2 keepalive frame failed: {}", e);
                }
            }
        }
    }

    cam_state.stop_active();
}

/// Ensure camera thread is running and get sender
fn get_or_create_sender(state: &CameraState) -> Result<Sender<CameraCommand>, String> {
    let mut sender_guard = state.sender.lock().map_err(|e| format!("Lock error: {}", e))?;
    
    if sender_guard.is_none() {
        let (tx, rx) = mpsc::channel();
        let frame_tx = state.frame_tx.clone();
        thread::spawn(move || camera_thread(rx, frame_tx));
        *sender_guard = Some(tx);
    }
    
    sender_guard.clone().ok_or_else(|| "Failed to get sender".to_string())
}

/// List all available cameras
#[tauri::command]
pub fn list_cameras(state: State<'_, CameraState>) -> Result<Vec<CameraDevice>, String> {
    log::info!("Listing available cameras");

    let mut cameras = Vec::new();

    // 1. Get system cameras
    if let Ok(devices) = nokhwa::query(nokhwa::utils::ApiBackend::Auto) {
        for info in devices {
            cameras.push(CameraDevice {
                id: info.index().to_string(),
                name: format!("{} (System)", info.human_name()),
            });
        }
    }

    let mut has_canon = false;
    let mut has_sony = false;

    // 2. Get Canon cameras via the camera thread (EDSDK is single-threaded,
    //    so all EDSDK calls must share the one thread that owns the session).
    if let Ok(sender) = get_or_create_sender(&state) {
        let (reply_tx, reply_rx) = mpsc::channel();
        if sender.send(CameraCommand::ListCanon { reply: reply_tx }).is_ok() {
            if let Ok(Ok(canon_devices)) = reply_rx.recv_timeout(Duration::from_secs(5)) {
                if !canon_devices.is_empty() {
                    has_canon = true;
                }
                cameras.extend(canon_devices);
            }
        }
    }

    // 3. Get Sony cameras via the camera thread (keeps the single CrSDK instance alive
    //    without calling sony_sdk_release() while a camera session may be active).
    if let Ok(sender) = get_or_create_sender(&state) {
        let (reply_tx, reply_rx) = mpsc::channel();
        if sender.send(CameraCommand::ListSony { reply: reply_tx }).is_ok() {
            if let Ok(Ok(sony_devices)) = reply_rx.recv_timeout(Duration::from_secs(8)) {
                if !sony_devices.is_empty() {
                    has_sony = true;
                }
                cameras.extend(sony_devices);
            }
        }
    }

    // 4. Fallback via libgphoto2 only when neither native SDK detected a camera,
    //    so libgphoto2 does not kill ptpcamerad or probe USB while Sony/Canon SDKs are in use.
    if !has_sony && !has_canon {
        if let Ok(sender) = get_or_create_sender(&state) {
            let (reply_tx, reply_rx) = mpsc::channel();
            if sender.send(CameraCommand::ListGPhoto2 { reply: reply_tx }).is_ok() {
                if let Ok(Ok(gp_devices)) = reply_rx.recv_timeout(Duration::from_secs(8)) {
                    for cam in gp_devices {
                        let is_canon_dev = cam.name.contains("(Canon SDK)");
                        if (is_canon_dev && !has_canon) || (!is_canon_dev && !has_sony) {
                            cameras.push(cam);
                        }
                    }
                }
            }
        }
    }
    
    log::info!("Found {} cameras", cameras.len());
    Ok(cameras)
}


/// Start the camera with specified device ID
#[tauri::command]
pub fn start_camera(
    state: State<'_, CameraState>,
    device_id: Option<String>,
) -> Result<CameraStatus, String> {
    let resolved_device_id = device_id.unwrap_or_else(|| "0".to_string());
    log::info!("Starting camera with device_id: {}", resolved_device_id);
    
    let is_canon = resolved_device_id.starts_with("canon_");
    let is_sony = resolved_device_id.starts_with("sony_");
    let is_gphoto2 = resolved_device_id.starts_with("gphoto2_");
    let sender = get_or_create_sender(&state)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    
    sender.send(CameraCommand::Start { device_id: resolved_device_id, is_canon, is_sony, is_gphoto2, requested_at: Instant::now(), reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;
    
    // Sony / Canon / gphoto2 connection can take longer (USB negotiation + PTP handshake)
    let timeout = if is_sony || is_canon || is_gphoto2 { Duration::from_secs(30) } else { Duration::from_secs(5) };
    reply_rx.recv_timeout(timeout)
        .map_err(|e| format!("Camera command timeout: {}", e))?
}


/// Stop the camera
#[tauri::command]
pub fn stop_camera(state: State<'_, CameraState>) -> Result<(), String> {
    log::info!("Stopping camera");
    
    let sender = get_or_create_sender(&state)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    
    sender.send(CameraCommand::Stop { reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;
    
    reply_rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Camera command timeout: {}", e))?
}

/// Get current camera status
#[tauri::command]
pub fn get_camera_status(state: State<'_, CameraState>) -> Result<CameraStatus, String> {
    let sender = get_or_create_sender(&state)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    
    sender.send(CameraCommand::GetStatus { reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;
    
    reply_rx.recv_timeout(Duration::from_secs(2))
        .map_err(|e| format!("Camera command timeout: {}", e))?
}

/// Capture a single frame and return as base64 JPEG
#[tauri::command]
pub fn capture_frame(state: State<'_, CameraState>, quality: Option<u8>) -> Result<String, String> {
    let sender = get_or_create_sender(&state)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    
    let quality = quality.unwrap_or(90);
    
    sender.send(CameraCommand::Capture { quality, reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;
    
    reply_rx.recv_timeout(Duration::from_secs(2))
        .map_err(|e| format!("Camera command timeout: {}", e))?
}

/// Get a preview frame (lower quality for live preview)
#[tauri::command]
pub fn get_preview_frame(state: State<'_, CameraState>) -> Result<String, String> {
    capture_frame(state, Some(60))
}

/// Sony-specific: trigger actual shutter release and return full-resolution image
#[tauri::command]
pub fn sony_capture_image(state: State<'_, CameraState>, quality: Option<u8>) -> Result<String, String> {
    log::info!("Sony shutter release triggered");
    
    let sender = get_or_create_sender(&state)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    
    let quality = quality.unwrap_or(95);
    
    sender.send(CameraCommand::SonyCapture { _quality: quality, requested_at: Instant::now(), reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;

    // Sony capture can take up to 15 seconds (AF + exposure + transfer)
    reply_rx.recv_timeout(Duration::from_secs(20))
        .map_err(|e| format!("Sony capture timeout: {}", e))?
}

/// Canon-specific: trigger actual shutter release and return full-resolution image
#[tauri::command]
pub fn canon_capture_image(state: State<'_, CameraState>, quality: Option<u8>) -> Result<String, String> {
    log::info!("Canon shutter release triggered");

    let sender = get_or_create_sender(&state)?;
    let (reply_tx, reply_rx) = mpsc::channel();

    let quality = quality.unwrap_or(95);

    sender.send(CameraCommand::CanonCapture { _quality: quality, requested_at: Instant::now(), reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;

    // Canon capture can take up to ~20 seconds (AF + exposure + USB transfer)
    reply_rx.recv_timeout(Duration::from_secs(25))
        .map_err(|e| format!("Canon capture timeout: {}", e))?
}
