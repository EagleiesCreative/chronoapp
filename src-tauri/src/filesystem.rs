use std::fs;
use std::path::PathBuf;
use base64::{Engine as _, engine::general_purpose};

/// Save a base64-encoded file to disk in the given directory.
/// Creates the directory recursively if it doesn't exist.
#[tauri::command]
pub async fn save_file_to_disk(
    dir_path: String,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    let dir = PathBuf::from(&dir_path);

    // Create directory recursively if it doesn't exist
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_path = dir.join(&file_name);

    // Decode base64 data
    let bytes = general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Write file
    fs::write(&file_path, &bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Open native OS folder picker dialog and return the selected path.
#[tauri::command]
pub async fn pick_directory() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Choose save directory for photos")
        .pick_folder();

    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

/// Check if a directory path exists and is writable.
/// Creates the directory if it doesn't exist.
#[tauri::command]
pub async fn check_directory_writable(dir_path: String) -> Result<bool, String> {
    let dir = PathBuf::from(&dir_path);
    if !dir.exists() {
        // Try to create it
        if let Err(e) = fs::create_dir_all(&dir) {
            return Err(format!("Cannot create directory: {}", e));
        }
    }
    // Test write
    let test_file = dir.join(".chronosnap_test");
    match fs::write(&test_file, b"test") {
        Ok(_) => {
            let _ = fs::remove_file(&test_file);
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}
