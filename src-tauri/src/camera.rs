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
use std::time::Duration;
use crate::canon::CanonSdk;
use crate::sony::SonySdk;
use tauri::State;


/// Messages sent to the camera thread
enum CameraCommand {
    Start { device_id: String, is_canon: bool, is_sony: bool, reply: Sender<Result<CameraStatus, String>> },
    Stop { reply: Sender<Result<(), String>> },
    Capture { quality: u8, reply: Sender<Result<String, String>> },
    GetStatus { reply: Sender<Result<CameraStatus, String>> },
    /// Sony-specific: trigger actual shutter release and return full-res image
    SonyCapture { _quality: u8, reply: Sender<Result<String, String>> },
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

/// Camera thread that owns the non-Send Camera
fn camera_thread(receiver: Receiver<CameraCommand>, frame_tx: crossbeam_channel::Sender<Vec<u8>>) {
    let mut camera: Option<Camera> = None;
    let canon_sdk = CanonSdk::load().ok();
    let sony_sdk = SonySdk::load().ok();
    // For now, we only hold a boolean for Canon since we don't have full FFI implementation yet
    let mut is_canon_active = false;
    let mut is_sony_active = false;
    // Sony session handle (raw pointer managed by bridge)
    let mut sony_session: Option<crate::sony::SonySession<'_>> = None;

    
    while let Ok(cmd) = receiver.recv_timeout(if camera.is_some() || is_canon_active || is_sony_active { Duration::from_millis(33) } else { Duration::from_secs(1) })
        .map(Some)
        .or_else(|e| {
            if e == mpsc::RecvTimeoutError::Timeout { Ok(None) } else { Err(e) }
        })
    {
        // Handle stream broadcasting outside of command handling
        if let Some(cam) = camera.as_mut() {
            if let Ok(frame) = cam.frame() {
                if let Ok(img) = frame.decode_image::<RgbFormat>() {
                    let mut jpeg_buffer = Cursor::new(Vec::new());
                    if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buffer, 60)
                        .encode_image(&img)
                        .is_ok()
                    {
                        // Send to stream server (ignore errors if no clients connected)
                        let _ = frame_tx.try_send(jpeg_buffer.into_inner());
                    }
                }
            }
        } else if is_sony_active {
            // Poll Sony live view frames and broadcast to MJPEG stream
            if let Some(ref session) = sony_session {
                if let Ok(frame_data) = session.get_live_view_frame() {
                    let _ = frame_tx.try_send(frame_data);
                }
            }
        } else if is_canon_active {
            // TODO: Broadcast Canon frames when Canon SDK is properly implemented here
        }

        if let Some(cmd) = cmd {
            match cmd {
                CameraCommand::Start { device_id, is_canon, is_sony, reply } => {
                    // Stop existing camera if any
                    if let Some(mut cam) = camera.take() {
                        cam.stop_stream().ok();
                    }
                    // Disconnect existing Sony session
                    sony_session = None;
                    is_sony_active = false;
                    is_canon_active = is_canon;
                    
                    let result = (|| -> Result<CameraStatus, String> {
                        if is_sony {
                            // Sony CrSDK: Connect and start live view
                            if let Some(ref sdk) = sony_sdk {
                                let idx_str = device_id.strip_prefix("sony_").unwrap_or("0");
                                let idx: u32 = idx_str.parse().unwrap_or(0);

                                let session = sdk.connect(idx)?;
                                session.start_live_view().ok(); // Best-effort live view

                                is_sony_active = true;
                                sony_session = Some(session);

                                Ok(CameraStatus {
                                    is_active: true,
                                    device_name: Some(format!("Sony Camera ({})", device_id)),
                                    resolution: Some((6000, 4000)), // Typical Sony full-frame
                                })
                            } else {
                                Err("Sony SDK not loaded. Place libsony_bridge.dylib in libs/".to_string())
                            }
                        } else if is_canon {
                            // TODO: Implement actual Canon session opening
                            if canon_sdk.is_some() {
                                Ok(CameraStatus {
                                    is_active: true,
                                    device_name: Some(format!("Canon Camera ({})", device_id)),
                                    resolution: Some((5184, 3456)), // Example DSLR res
                                })
                            } else {
                                Err("Canon SDK not loaded".to_string())
                            }
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
                            
                            camera = Some(cam);
                            Ok(status)
                        }
                    })();
                    
                    reply.send(result).ok();
                }
                
                CameraCommand::Stop { reply } => {
                    if is_sony_active {
                        if let Some(ref session) = sony_session {
                            session.stop_live_view().ok();
                        }
                        sony_session = None;
                        is_sony_active = false;
                    } else if is_canon_active {
                        is_canon_active = false;
                    } else if let Some(mut cam) = camera.take() {
                        cam.stop_stream().ok();
                    }
                    reply.send(Ok(())).ok();
                }
                
                CameraCommand::Capture { quality, reply } => {
                    let result = (|| -> Result<String, String> {
                        if is_sony_active {
                            // For preview capture, grab a live view frame
                            if let Some(ref session) = sony_session {
                                let frame_data = session.get_live_view_frame()
                                    .map_err(|e| format!("Sony preview frame error: {}", e))?;
                                let base64_data = STANDARD.encode(&frame_data);
                                let data_url = format!("data:image/jpeg;base64,{}", base64_data);
                                Ok(data_url)
                            } else {
                                Err("Sony session not active".to_string())
                            }
                        } else if is_canon_active {
                            Err("Canon native capture not yet implemented (requires framework)".to_string())
                        } else if let Some(cam) = camera.as_mut() {
                            let frame = cam.frame()
                                .map_err(|e| format!("Failed to capture frame: {}", e))?;
                            
                            let img = frame.decode_image::<RgbFormat>()
                                .map_err(|e| format!("Failed to decode frame: {}", e))?;
                            
                            let mut jpeg_buffer = Cursor::new(Vec::new());
                            
                            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buffer, quality)
                                .encode_image(&img)
                                .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
                            
                            let base64_data = STANDARD.encode(jpeg_buffer.into_inner());
                            let data_url = format!("data:image/jpeg;base64,{}", base64_data);
                            
                            Ok(data_url)
                        } else {
                            Err("Camera not started".to_string())
                        }
                    })();
                    
                    reply.send(result).ok();
                }
                
                CameraCommand::SonyCapture { _quality: _, reply } => {
                    let result = (|| -> Result<String, String> {
                        if let Some(ref session) = sony_session {
                            let image_data = session.capture_still()
                                .map_err(|e| format!("Sony shutter release failed: {}", e))?;
                            let base64_data = STANDARD.encode(&image_data);
                            let data_url = format!("data:image/jpeg;base64,{}", base64_data);
                            Ok(data_url)
                        } else {
                            Err("Sony camera not connected".to_string())
                        }
                    })();
                    
                    reply.send(result).ok();
                }
                
                CameraCommand::GetStatus { reply } => {
                    let status = if is_sony_active {
                        let connected = sony_session.as_ref().map_or(false, |s| s.is_connected());
                        CameraStatus {
                            is_active: connected,
                            device_name: Some("Sony Camera".to_string()),
                            resolution: Some((6000, 4000)),
                        }
                    } else if is_canon_active {
                        CameraStatus {
                            is_active: true,
                            device_name: Some("Canon Camera".to_string()),
                            resolution: Some((5184, 3456)),
                        }
                    } else {
                        match &camera {
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
    
    // Cleanup on thread exit
    if let Some(mut cam) = camera.take() {
        cam.stop_stream().ok();
    }
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
pub fn list_cameras() -> Result<Vec<CameraDevice>, String> {
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
    
    // 2. Get Canon cameras if SDK is available
    if let Ok(sdk) = CanonSdk::load() {
        if let Ok(canon_devices) = sdk.list_cameras() {
            for cam in canon_devices {
                cameras.push(CameraDevice {
                    id: cam.id,
                    name: format!("{} (Canon SDK)", cam.name),
                });
            }
        }
    }

    // 3. Get Sony cameras if CrSDK bridge is available
    if let Ok(sdk) = SonySdk::load() {
        if let Ok(sony_devices) = sdk.list_cameras() {
            for cam in sony_devices {
                cameras.push(CameraDevice {
                    id: cam.id,
                    name: format!("{} (Sony SDK)", cam.name),
                });
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
    let sender = get_or_create_sender(&state)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    
    sender.send(CameraCommand::Start { device_id: resolved_device_id, is_canon, is_sony, reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;
    
    // Sony connection can take longer (USB negotiation + PTP handshake)
    let timeout = if is_sony { Duration::from_secs(15) } else { Duration::from_secs(5) };
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
    
    sender.send(CameraCommand::SonyCapture { _quality: quality, reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;
    
    // Sony capture can take up to 15 seconds (AF + exposure + transfer)
    reply_rx.recv_timeout(Duration::from_secs(20))
        .map_err(|e| format!("Sony capture timeout: {}", e))?
}
