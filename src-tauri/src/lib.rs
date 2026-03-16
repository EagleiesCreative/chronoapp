mod printer;
mod camera;
mod filesystem;
mod canon;
mod image_processor;
mod stream_server;
mod reliability;

use camera::CameraState;
use image_processor::{composite_images, CompositeRequest, CompositeResponse};
use reliability::setup_reliability;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use crossbeam_channel::unbounded;
use tauri::Manager;

#[tauri::command]
async fn composite_image_rust(req: CompositeRequest) -> Result<CompositeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        composite_images(req)
    })
    .await
    .map_err(|e| format!("Task panic: {}", e))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let (frame_tx, frame_rx) = unbounded();
  
  tauri::Builder::default()
    .manage(CameraState::new(frame_tx))
    .setup(|app| {
      let reliability_state = setup_reliability(app)
        .map_err(|e| format!("Failed to initialize reliability worker: {e}"))?;
      app.manage(reliability_state);

      // Start MJPEG Server
      let running = Arc::new(AtomicBool::new(true));
      let _server_thread = std::thread::spawn(move || {
          if let Err(e) = stream_server::start_mjpeg_server(3030, frame_rx, running) {
              log::error!("MJPEG server error: {}", e);
          }
      });

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      printer::get_printers,
      printer::get_default_printer,
      printer::print_test_page,
      printer::print_photo,
      printer::get_print_queue,
      printer::clear_print_queue,
      printer::resume_printer,
      camera::list_cameras,
      camera::start_camera,
      camera::stop_camera,
      camera::get_camera_status,
      camera::capture_frame,
      camera::get_preview_frame,
      filesystem::save_file_to_disk,
      filesystem::pick_directory,
      filesystem::check_directory_writable,
      reliability::queue_session_sync,
      reliability::set_sync_config,
      reliability::get_sync_queue_stats,
      composite_image_rust,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

