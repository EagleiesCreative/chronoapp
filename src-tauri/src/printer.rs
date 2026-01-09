use printers;
use printers::common::base::job::PrinterJobOptions;
use serde::Serialize;
use tauri::command;

/// Printer info returned to the frontend
#[derive(Debug, Serialize)]
pub struct PrinterInfo {
    pub name: String,
    pub system_name: String,
    pub is_default: bool,
    pub is_shared: bool,
    pub driver_name: String,
    pub uri: String,
    pub state: String,
}

/// Get list of all available printers
#[command]
pub fn get_printers() -> Result<Vec<PrinterInfo>, String> {
    let system_printers = printers::get_printers();
    
    let printers_info: Vec<PrinterInfo> = system_printers
        .into_iter()
        .map(|p| PrinterInfo {
            name: p.name.clone(),
            system_name: p.system_name.clone(),
            is_default: p.is_default,
            is_shared: p.is_shared,
            driver_name: p.driver_name.clone(),
            uri: p.uri.clone(),
            state: format!("{:?}", p.state),
        })
        .collect();
    
    Ok(printers_info)
}

/// Get the default system printer
#[command]
pub fn get_default_printer() -> Result<Option<PrinterInfo>, String> {
    match printers::get_default_printer() {
        Some(p) => Ok(Some(PrinterInfo {
            name: p.name.clone(),
            system_name: p.system_name.clone(),
            is_default: p.is_default,
            is_shared: p.is_shared,
            driver_name: p.driver_name.clone(),
            uri: p.uri.clone(),
            state: format!("{:?}", p.state),
        })),
        None => Ok(None),
    }
}

/// Print a test page to the specified printer
#[command]
pub fn print_test_page(printer_name: String) -> Result<String, String> {
    // Find the printer by name
    let system_printers = printers::get_printers();
    let printer = system_printers
        .into_iter()
        .find(|p| p.name == printer_name || p.system_name == printer_name);
    
    match printer {
        Some(p) => {
            // Create a simple test page content
            let test_content = format!(
                r#"
ChronoSnap Printer Test Page
=============================

Printer: {}
Driver: {}
Status: {:?}

If you can read this clearly, your printer is working correctly!

Colors: [Black] [Cyan] [Magenta] [Yellow]

Test printed at: {}

ChronoSnap Photobooth System
"#,
                p.name,
                p.driver_name,
                p.state,
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
            );
            
            // Create print job options with the job name
            let options = PrinterJobOptions {
                name: Some("ChronoSnap Test Page"),
                raw_properties: &[],
            };
            
            // Print the test content
            match p.print(test_content.as_bytes(), options) {
                Ok(_) => Ok(format!("Test page sent to printer: {}", p.name)),
                Err(e) => Err(format!("Failed to print: {:?}", e)),
            }
        }
        None => Err(format!("Printer '{}' not found", printer_name)),
    }
}

/// Print a photo to the specified printer (or default if not specified)
/// Takes base64 encoded image data (JPEG)
#[command]
pub fn print_photo(image_data: String, printer_name: Option<String>) -> Result<String, String> {
    // Remove data URL prefix if present
    let base64_data = if image_data.starts_with("data:image") {
        image_data
            .split(',')
            .nth(1)
            .ok_or("Invalid image data format")?
    } else {
        &image_data
    };
    
    // Decode base64 to bytes
    let image_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64_data)
        .map_err(|e| format!("Failed to decode image: {}", e))?;
    
    // Get the printer
    let system_printers = printers::get_printers();
    let printer = if let Some(name) = printer_name {
        system_printers
            .into_iter()
            .find(|p| p.name == name || p.system_name == name)
    } else {
        printers::get_default_printer()
    };
    
    match printer {
        Some(p) => {
            let options = PrinterJobOptions {
                name: Some("ChronoSnap Photo"),
                raw_properties: &[],
            };
            
            match p.print(&image_bytes, options) {
                Ok(_) => Ok(format!("Photo sent to printer: {}", p.name)),
                Err(e) => Err(format!("Failed to print photo: {:?}", e)),
            }
        }
        None => Err("No printer found".to_string()),
    }
}
