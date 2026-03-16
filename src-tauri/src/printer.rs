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
pub fn print_photo(image_data: String, printer_name: Option<String>, page_size: Option<String>) -> Result<String, String> {
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
            // Setup properties (e.g., PageSize)
            let mut properties = Vec::new();
            let page_size_val = page_size.unwrap_or_else(|| "Postcard".to_string()); // Default to Postcard (4R)
            properties.push(("PageSize", page_size_val.as_str()));
            
            let options = PrinterJobOptions {
                name: Some("ChronoSnap Photo"),
                raw_properties: &properties,
            };
            
            match p.print(&image_bytes, options) {
                Ok(_) => Ok(format!("Photo sent to printer: {} (Size: {})", p.name, page_size_val)),
                Err(e) => Err(format!("Failed to print photo: {:?}", e)),
            }
        }
        None => Err("No printer found".to_string()),
    }
}

/// Print job info returned to the frontend
#[derive(Debug, Serialize)]
pub struct PrintJobInfo {
    pub id: String,
    pub user: String,
    pub size: String,
    pub date: String,
}

/// Get the active print queue for a specific printer
#[command]
pub fn get_print_queue(printer_name: String) -> Result<Vec<PrintJobInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        
        // Execute lpstat -W not-completed -o printer_name
        let output = Command::new("lpstat")
            .arg("-W")
            .arg("not-completed")
            .arg("-o")
            .arg(&printer_name)
            .output()
            .map_err(|e| format!("Failed to execute lpstat: {}", e))?;
            
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // It's normal for lpstat to return cleanly with empty output or minor errors if queue is empty
            if stderr.contains("not found") {
                return Err(format!("Printer queue not found: {}", stderr));
            }
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut jobs = Vec::new();
        
        for line in stdout.lines() {
            // Example output: 
            // Brother_DCP_T710W-123  user  1024   Thu 14 Mar 12:00:00 2026
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                jobs.push(PrintJobInfo {
                    id: parts[0].to_string(),
                    user: parts[1].to_string(),
                    size: parts[2].to_string(),
                    date: parts[3..].join(" "),
                });
            }
        }
        
        Ok(jobs)
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Err("Print queue management is currently only supported on macOS".to_string())
    }
}

/// Clear all pending jobs for a specific printer
#[command]
pub fn clear_print_queue(printer_name: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        
        // Execute cancel -a printer_name
        let output = Command::new("cancel")
            .arg("-a")
            .arg(&printer_name)
            .output()
            .map_err(|e| format!("Failed to execute cancel: {}", e))?;
            
        if output.status.success() {
            Ok(format!("Cleared print queue for {}", printer_name))
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to clear queue: {}", stderr))
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Err("Print queue management is currently only supported on macOS".to_string())
    }
}

/// Forcefully resume a paused printer
#[command]
pub fn resume_printer(printer_name: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        
        // Execute cupsenable printer_name
        let output = Command::new("cupsenable")
            .arg(&printer_name)
            .output()
            .map_err(|e| format!("Failed to execute cupsenable: {}", e))?;
            
        if output.status.success() {
            Ok(format!("Resumed printer {}", printer_name))
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to resume printer: {}", stderr))
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Err("Printer resume is currently only supported on macOS".to_string())
    }
}
