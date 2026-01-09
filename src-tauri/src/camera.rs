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
use tauri::State;

/// Messages sent to the camera thread
enum CameraCommand {
    Start { device_id: Option<String>, reply: Sender<Result<CameraStatus, String>> },
    Stop { reply: Sender<Result<(), String>> },
    Capture { quality: u8, reply: Sender<Result<String, String>> },
    GetStatus { reply: Sender<Result<CameraStatus, String>> },
}

/// Camera state managed by Tauri - holds a channel to the camera thread
pub struct CameraState {
    sender: Mutex<Option<Sender<CameraCommand>>>,
}

impl Default for CameraState {
    fn default() -> Self {
        Self {
            sender: Mutex::new(None),
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
fn camera_thread(receiver: Receiver<CameraCommand>) {
    let mut camera: Option<Camera> = None;
    
    while let Ok(cmd) = receiver.recv() {
        match cmd {
            CameraCommand::Start { device_id, reply } => {
                // Stop existing camera if any
                if let Some(mut cam) = camera.take() {
                    cam.stop_stream().ok();
                }
                
                let result = (|| -> Result<CameraStatus, String> {
                    let index = match device_id {
                        Some(id) => {
                            let idx: u32 = id.parse().unwrap_or(0);
                            CameraIndex::Index(idx)
                        }
                        None => CameraIndex::Index(0),
                    };
                    
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
                })();
                
                reply.send(result).ok();
            }
            
            CameraCommand::Stop { reply } => {
                if let Some(mut cam) = camera.take() {
                    cam.stop_stream().ok();
                }
                reply.send(Ok(())).ok();
            }
            
            CameraCommand::Capture { quality, reply } => {
                let result = (|| -> Result<String, String> {
                    let cam = camera.as_mut()
                        .ok_or_else(|| "Camera not started".to_string())?;
                    
                    let frame = cam.frame()
                        .map_err(|e| format!("Failed to capture frame: {}", e))?;
                    
                    // Use decode_image which properly handles format conversion
                    let img = frame.decode_image::<RgbFormat>()
                        .map_err(|e| format!("Failed to decode frame: {}", e))?;
                    
                    let mut jpeg_buffer = Cursor::new(Vec::new());
                    
                    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buffer, quality)
                        .encode_image(&img)
                        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
                    
                    let base64_data = STANDARD.encode(jpeg_buffer.into_inner());
                    let data_url = format!("data:image/jpeg;base64,{}", base64_data);
                    
                    Ok(data_url)
                })();
                
                reply.send(result).ok();
            }
            
            CameraCommand::GetStatus { reply } => {
                let status = match &camera {
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
                };
                reply.send(Ok(status)).ok();
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
        thread::spawn(move || camera_thread(rx));
        *sender_guard = Some(tx);
    }
    
    sender_guard.clone().ok_or_else(|| "Failed to get sender".to_string())
}

/// List all available cameras
#[tauri::command]
pub fn list_cameras() -> Result<Vec<CameraDevice>, String> {
    log::info!("Listing available cameras");
    
    let devices = nokhwa::query(nokhwa::utils::ApiBackend::Auto)
        .map_err(|e| format!("Failed to query cameras: {}", e))?;
    
    let cameras: Vec<CameraDevice> = devices
        .iter()
        .map(|info| CameraDevice {
            id: info.index().to_string(),
            name: info.human_name().to_string(),
        })
        .collect();
    
    log::info!("Found {} cameras", cameras.len());
    Ok(cameras)
}

/// Start the camera with specified device ID
#[tauri::command]
pub fn start_camera(
    state: State<'_, CameraState>,
    device_id: Option<String>,
) -> Result<CameraStatus, String> {
    log::info!("Starting camera with device_id: {:?}", device_id);
    
    let sender = get_or_create_sender(&state)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    
    sender.send(CameraCommand::Start { device_id, reply: reply_tx })
        .map_err(|e| format!("Failed to send command: {}", e))?;
    
    reply_rx.recv_timeout(Duration::from_secs(5))
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
