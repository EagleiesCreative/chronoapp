mod printer;
mod camera;
mod filesystem;

use camera::CameraState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(CameraState::default())
    .setup(|app| {
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
      camera::list_cameras,
      camera::start_camera,
      camera::stop_camera,
      camera::get_camera_status,
      camera::capture_frame,
      camera::get_preview_frame,
      filesystem::save_file_to_disk,
      filesystem::pick_directory,
      filesystem::check_directory_writable,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

