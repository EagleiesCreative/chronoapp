use printers;
use printers::common::base::job::PrinterJobOptions;
use printers::common::converters::Converter;
use serde::Serialize;
use tauri::command;

/// Candidate CUPS media names for a 4R (4x6") borderless photo, in priority order.
/// The app always prints on physical 4R media (2R is duplicated 2-up onto a 4R sheet),
/// so this list is what makes printing work across different drivers:
///   - Brother .......... "4x6.Fullbleed"
///   - DNP RX-1 / Gutenprint / DS series ... "w288h432" (4x6 in points, borderless)
///   - Generic / PWG .... "4x6", "oe_photo-4x6_4x6in", "na_index-4x6_4x6in"
///   - DNP official ..... "PC-4x6", "Postcard"
#[cfg(target_os = "macos")]
const MEDIA_4R_CANDIDATES: &[&str] = &[
    "4x6.Fullbleed",
    "w288h432",
    "4x6",
    "6x4",
    "oe_photo-4x6_4x6in",
    "na_index-4x6_4x6in",
    "PC-4x6",
    "Postcard",
];

/// Query a printer's available option choices via `lpoptions -p <printer> -l`.
/// Returns the raw lines (e.g. "PageSize/Media Size: 4x6 *w288h432 6x8 ...").
/// If `printer` is None, queries the CUPS default printer.
#[cfg(target_os = "macos")]
fn lpoptions_list(printer: Option<&str>) -> Vec<String> {
    use std::process::Command;
    let mut cmd = Command::new("lpoptions");
    if let Some(p) = printer {
        cmd.arg("-p").arg(p);
    }
    cmd.arg("-l");
    match cmd.output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.to_string())
            .collect(),
        _ => Vec::new(),
    }
}

/// Extract the set of choice tokens for a given option keyword (e.g. "PageSize")
/// from `lpoptions -l` output. Strips the leading '*' that marks the current default.
#[cfg(target_os = "macos")]
fn option_choices(lines: &[String], keyword: &str) -> Vec<String> {
    for line in lines {
        // Format: "PageSize/Media Size: A4 *4x6 6x8"
        let head = line.split(':').next().unwrap_or("");
        let key = head.split('/').next().unwrap_or("").trim();
        if key.eq_ignore_ascii_case(keyword) {
            if let Some(rest) = line.split_once(':').map(|(_, r)| r) {
                return rest
                    .split_whitespace()
                    .map(|t| t.trim_start_matches('*').to_string())
                    .collect();
            }
        }
    }
    Vec::new()
}

/// Resolve the best CUPS media name to use for a 4R photo on the given printer.
/// Detection order:
///   1. FRAMR_MEDIA_4R env var override (operator escape hatch), if set.
///   2. First entry of MEDIA_4R_CANDIDATES that the driver actually advertises
///      (PageSize or PageRegion), so it auto-adapts to DNP / Brother / etc.
///   3. Fallback to generic "4x6" if nothing could be detected.
#[cfg(target_os = "macos")]
fn resolve_4r_media(printer: Option<&str>) -> String {
    if let Ok(overridden) = std::env::var("FRAMR_MEDIA_4R") {
        let overridden = overridden.trim().to_string();
        if !overridden.is_empty() {
            return overridden;
        }
    }

    let lines = lpoptions_list(printer);
    if !lines.is_empty() {
        let mut available = option_choices(&lines, "PageSize");
        available.extend(option_choices(&lines, "PageRegion"));
        for candidate in MEDIA_4R_CANDIDATES {
            if available.iter().any(|a| a.eq_ignore_ascii_case(candidate)) {
                return (*candidate).to_string();
            }
        }
    }

    // Nothing detected (printer offline / unknown driver): safest generic name.
    "4x6".to_string()
}

/// Whether the driver exposes a MediaType option (Brother inkjets do; most
/// dye-sub printers like the DNP RX-1 do not and would reject the option).
#[cfg(target_os = "macos")]
fn driver_supports_media_type(printer: Option<&str>) -> bool {
    let lines = lpoptions_list(printer);
    !option_choices(&lines, "MediaType").is_empty()
}

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
Framr Studio Printer Test Page
==============================

Printer: {}
Driver: {}
Status: {:?}

If you can read this clearly, your printer is working correctly!

Colors: [Black] [Cyan] [Magenta] [Yellow]

Test printed at: {}

Framr Studio Photobooth System
"#,
                p.name,
                p.driver_name,
                p.state,
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
            );
            
            // Create print job options with the job name
            let options = PrinterJobOptions {
                name: Some("Framr Studio Test Page"),
                raw_properties: &[],
                converter: Converter::None,
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
    
    // Determine the target printer name
    let target_printer_name = if let Some(ref name) = printer_name {
        let system_printers = printers::get_printers();
        let found = system_printers
            .iter()
            .find(|p| p.name == *name || p.system_name == *name);
        match found {
            Some(p) => Some(p.system_name.clone()),
            None => return Err(format!("Printer '{}' not found", name)),
        }
    } else {
        // None = use CUPS default printer (don't pass -d flag)
        None
    };

    // Normalize the requested page size ("2R" and "4R" both print on 4x6 media,
    // since 2R is duplicated 2-up onto a single 4R sheet upstream).
    let page_size_val = page_size.unwrap_or_else(|| "4R".to_string());

    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::process::Command;

        // Resolve the actual CUPS media name for THIS printer's driver.
        // A3/A4 are passed through; everything else resolves to a real 4x6 name
        // (DNP RX-1: w288h432, Brother: 4x6.Fullbleed, generic: 4x6, ...).
        let cups_media = match page_size_val.as_str() {
            "A3" => "A3".to_string(),
            "A4" => "A4".to_string(),
            _ => resolve_4r_media(target_printer_name.as_deref()),
        };

        // Write image bytes to a temp file
        let temp_path = format!("/tmp/chronosnap_print_{}.jpg", chrono::Utc::now().timestamp_millis());
        fs::write(&temp_path, &image_bytes)
            .map_err(|e| format!("Failed to write temp print file: {}", e))?;

        // Build lp command with CUPS options for 4R borderless
        let mut cmd = Command::new("lp");

        // Specify printer if provided (otherwise CUPS uses its default)
        if let Some(ref pname) = target_printer_name {
            cmd.arg("-d").arg(pname);
        }

        cmd.arg("-o").arg(format!("media={}", cups_media));
        // Only send MediaType on drivers that expose it (Brother inkjets).
        // Dye-sub printers like the DNP RX-1 have no MediaType option and would
        // reject/complain about this, so we skip it for them.
        if driver_supports_media_type(target_printer_name.as_deref()) {
            cmd.arg("-o").arg("MediaType=photographic-glossy");
        }
        cmd.arg("-o").arg("fit-to-page");
        cmd.arg("-t").arg("Framr Studio Photo");
        cmd.arg(&temp_path);

        let output = cmd.output()
            .map_err(|e| format!("Failed to execute lp command: {}", e))?;

        // Clean up temp file (best-effort)
        let _ = fs::remove_file(&temp_path);

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let printer_label = target_printer_name.as_deref().unwrap_or("default");
            Ok(format!("Photo sent to printer: {} (Media: {}) — {}", printer_label, cups_media, stdout.trim()))
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("lp command failed: {}", stderr))
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Fallback: use printers crate on non-macOS
        let system_printers = printers::get_printers();
        let printer = if let Some(ref name) = printer_name {
            system_printers
                .into_iter()
                .find(|p| p.name == *name || p.system_name == *name)
        } else {
            printers::get_default_printer()
        };

        // On non-macOS we can't run lpoptions detection, so pick a sensible name.
        let cups_media: &str = match page_size_val.as_str() {
            "A3" => "A3",
            "A4" => "A4",
            _ => "4x6",
        };

        match printer {
            Some(p) => {
                let mut properties = Vec::new();
                properties.push(("PageSize", cups_media));

                let options = PrinterJobOptions {
                    name: Some("Framr Studio Photo"),
                    raw_properties: &properties,
                    converter: Converter::None,
                };

                match p.print(&image_bytes, options) {
                    Ok(_) => Ok(format!("Photo sent to printer: {} (Size: {})", p.name, cups_media)),
                    Err(e) => Err(format!("Failed to print photo: {:?}", e)),
                }
            }
            None => Err("No printer found".to_string()),
        }
    }
}

/// Media capability report for a printer, used to verify 2R/4R support
/// (e.g. confirming a DNP RX-1 is set up to print 4x6).
#[derive(Debug, Serialize)]
pub struct PrinterMediaInfo {
    /// All PageSize/media choices the driver advertises.
    pub available_media: Vec<String>,
    /// The 4x6 media name that will actually be used for 2R/4R prints.
    pub resolved_4r_media: String,
    /// Whether a usable 4x6 media name was found for this driver.
    pub supports_4r: bool,
    /// Whether the driver exposes a MediaType option (Brother yes, DNP no).
    pub supports_media_type: bool,
}

/// Inspect a printer's available media names and report what the app will use
/// for 4R (4x6") prints. Pass None to inspect the CUPS default printer.
/// Useful for confirming a DNP RX-1 (or similar) can print 2R/4R.
#[command]
pub fn get_printer_media_options(printer_name: Option<String>) -> Result<PrinterMediaInfo, String> {
    #[cfg(target_os = "macos")]
    {
        // Resolve to the driver's system_name if a friendly name was passed.
        let system_name: Option<String> = match printer_name {
            Some(ref name) => {
                let system_printers = printers::get_printers();
                match system_printers
                    .iter()
                    .find(|p| p.name == *name || p.system_name == *name)
                {
                    Some(p) => Some(p.system_name.clone()),
                    None => return Err(format!("Printer '{}' not found", name)),
                }
            }
            None => None,
        };

        let lines = lpoptions_list(system_name.as_deref());
        let mut available = option_choices(&lines, "PageSize");
        for r in option_choices(&lines, "PageRegion") {
            if !available.iter().any(|a| a.eq_ignore_ascii_case(&r)) {
                available.push(r);
            }
        }

        let resolved = resolve_4r_media(system_name.as_deref());
        let supports_4r = available
            .iter()
            .any(|a| a.eq_ignore_ascii_case(&resolved))
            || std::env::var("FRAMR_MEDIA_4R").is_ok();

        Ok(PrinterMediaInfo {
            available_media: available,
            resolved_4r_media: resolved,
            supports_4r,
            supports_media_type: driver_supports_media_type(system_name.as_deref()),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = printer_name;
        Err("Media inspection is currently only supported on macOS".to_string())
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
