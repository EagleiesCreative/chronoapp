use printers;
// Only the non-Windows test-print path uses the printers-crate job API; on
// Windows we print via PowerShell, so these would be unused there.
#[cfg(not(target_os = "windows"))]
use printers::common::base::job::PrinterJobOptions;
#[cfg(not(target_os = "windows"))]
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

// ---------------------------------------------------------------------------
// Windows print-management helpers
//
// Windows has no `lp`/`lpstat`/`cupsenable`, so the four printer-management
// commands and the photo print path shell out to PowerShell. Each script is
// written to a temp .ps1 and executed with -NoProfile -ExecutionPolicy Bypass;
// runtime values (printer name, image path) are passed as named parameters so
// user-supplied strings are never interpolated into the script body.
// ---------------------------------------------------------------------------

/// Run an embedded PowerShell script with the given named args, returning
/// stdout on success or a descriptive error (including stderr) on failure.
///
/// The child is spawned (not run to completion inline) and polled against a
/// deadline. If a printer driver call inside the script hangs — a real failure
/// mode with dye-sub drivers like the DNP RX1HS — the child is force-killed and
/// an error is returned, so a stuck driver can never freeze or crash the app.
#[cfg(target_os = "windows")]
fn run_powershell(script: &str, args: &[&str], timeout_secs: u64) -> Result<String, String> {
    use std::fs;
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    let script_path = std::env::temp_dir().join(format!(
        "chronosnap_ps_{}.ps1",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    ));
    fs::write(&script_path, script)
        .map_err(|e| format!("Failed to write PowerShell script: {}", e))?;

    let mut cmd = Command::new("powershell");
    cmd.arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for a in args {
        cmd.arg(a);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = fs::remove_file(&script_path);
            return Err(format!("Failed to launch powershell: {}", e));
        }
    };

    // Poll for completion up to the deadline; kill if the driver call hangs.
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = fs::remove_file(&script_path);
                return Err(format!("Failed while waiting on powershell: {}", e));
            }
        }
    };

    let _ = fs::remove_file(&script_path);

    let status = match status {
        Some(s) => s,
        None => {
            return Err(format!(
                "PowerShell timed out after {}s — the printer driver is not responding",
                timeout_secs
            ))
        }
    };

    // Outputs are small (a media list or a one-line result), so reading after
    // exit won't deadlock on a full pipe.
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut o) = child.stdout.take() {
        let _ = o.read_to_string(&mut stdout);
    }
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut stderr);
    }

    if status.success() {
        Ok(stdout)
    } else {
        Err(format!("{}{}", stderr.trim(), stdout.trim()))
    }
}

/// Render a JPEG to a printer at the correct paper size using GDI. Matches an
/// existing 4x6 (or A4/A3) paper by dimensions, else creates a custom size,
/// and prints full-bleed (borderless) — required for DNP dye-sub photo output.
#[cfg(target_os = "windows")]
const PRINT_PHOTO_PS: &str = r#"
param(
  [Parameter(Mandatory=$true)][string]$ImagePath,
  [string]$PrinterName = "",
  [string]$PageSize = "4R",
  [string]$Rotate = "auto"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
# Win32 SetICMMode lets us turn ON color management for the printer device
# context, so the driver's colour profile is applied (neutral black) instead of
# raw device RGB (which prints black as olive-green on the DNP dye-sub).
Add-Type -Namespace Framr -Name Gdi -MemberDefinition @"
[DllImport("gdi32.dll")]
public static extern int SetICMMode(System.IntPtr hdc, int mode);
"@

$img = [System.Drawing.Image]::FromFile($ImagePath)
try {
  $doc = New-Object System.Drawing.Printing.PrintDocument
  if ($PrinterName -ne "") { $doc.PrinterSettings.PrinterName = $PrinterName }
  if (-not $doc.PrinterSettings.IsValid) { throw "Invalid printer: '$PrinterName'" }
  $doc.DocumentName = "Framr Studio Photo"

  # Use the DRIVER DEFAULT media for 4x6/2R (the DNP's own 6x4) — the same thing
  # Windows uses when you print the file directly, which the operator confirmed
  # works perfectly. We only force a paper size for the A4/A3 newspaper booth.
  switch ($PageSize) {
    "A4" { $tw = 827;  $th = 1169 }
    "A3" { $tw = 1169; $th = 1654 }
    default { $tw = 0; $th = 0 }
  }
  if ($tw -gt 0) {
    foreach ($ps in $doc.PrinterSettings.PaperSizes) {
      if (($ps.Width -eq $tw -and $ps.Height -eq $th) -or ($ps.Width -eq $th -and $ps.Height -eq $tw)) {
        $doc.DefaultPageSettings.PaperSize = $ps; break
      }
    }
  }

  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
  $doc.OriginAtMargins = $false

  $rot = $Rotate
  $doc.add_PrintPage({
    param($s, $e)
    $b = $e.PageBounds

    # Turn ON ICM colour management for this page's printer DC. This applies the
    # DNP driver's colour profile (ICM_ON = 1), matching what Windows does when
    # you print the file directly, so black prints as neutral black.
    $ICM_ON = 1
    $hdc = $e.Graphics.GetHdc()
    try { [Framr.Gdi]::SetICMMode($hdc, $ICM_ON) | Out-Null } finally { $e.Graphics.ReleaseHdc($hdc) }

    # Simple, predictable rotation. "auto" rotates the image only if needed so
    # its long edge matches the sheet's long edge (fills without distortion).
    # A manual 90/180/270 is applied exactly as chosen and is NOT overridden —
    # this is the operator's knob to get orientation right on the DNP.
    switch ($rot) {
      "90"  { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
      "180" { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
      "270" { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
      default {
        $pageLandscape = $b.Width -gt $b.Height
        $imgLandscape  = $img.Width -gt $img.Height
        if ($pageLandscape -ne $imgLandscape) {
          $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
        }
      }
    }

    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $e.Graphics.DrawImage($img, $b)
  })
  $doc.Print()
  Write-Output ("Printed on {0}" -f $doc.PrinterSettings.PrinterName)
} finally {
  $img.Dispose()
}
"#;

/// Print a simple GDI text test page. Deliberately does NOT enumerate
/// PaperSizes (that call can hang some dye-sub drivers) — it prints on the
/// driver's default media, which for a DNP RX1HS is the loaded 4x6 stock.
#[cfg(target_os = "windows")]
const TEST_PAGE_PS: &str = r#"
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [string]$Rotate = "auto"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $PrinterName
if (-not $doc.PrinterSettings.IsValid) { throw "Invalid printer: '$PrinterName'" }
$doc.DocumentName = "Framr Studio Test Page"
$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$rot = $Rotate
$doc.add_PrintPage({
  param($s, $e)
  $g = $e.Graphics
  $b = $e.PageBounds
  # Apply the same manual rotation so the operator can SEE how the current
  # setting orients the sheet. "TOP" should end up at the top of the print.
  switch ($rot) {
    "90"  { $g.TranslateTransform($b.Width, 0); $g.RotateTransform(90) }
    "180" { $g.TranslateTransform($b.Width, $b.Height); $g.RotateTransform(180) }
    "270" { $g.TranslateTransform(0, $b.Height); $g.RotateTransform(270) }
  }
  $bigFont = New-Object System.Drawing.Font("Arial", 20, [System.Drawing.FontStyle]::Bold)
  $font = New-Object System.Drawing.Font("Arial", 12)
  $g.DrawString("^ TOP OF PRINT ^", $bigFont, [System.Drawing.Brushes]::Black, 40, 30)
  $text = "Framr Studio Printer Test Page`n`nPrinter: $PrinterName`nRotation: $rot`n`nIf 'TOP' is at the top and readable,`nthis rotation setting is correct.`n`n$stamp"
  $g.DrawString($text, $font, [System.Drawing.Brushes]::Black, 40, 90)
  $bigFont.Dispose()
  $font.Dispose()
})
$doc.Print()
Write-Output "Test page sent to $PrinterName"
"#;

/// Enumerate a printer's paper sizes as `Name|WxH` lines (H/W in 1/100 inch).
#[cfg(target_os = "windows")]
const MEDIA_OPTIONS_PS: &str = r#"
param([string]$PrinterName = "")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$doc = New-Object System.Drawing.Printing.PrintDocument
if ($PrinterName -ne "") { $doc.PrinterSettings.PrinterName = $PrinterName }
if (-not $doc.PrinterSettings.IsValid) { throw "Invalid printer: '$PrinterName'" }
foreach ($ps in $doc.PrinterSettings.PaperSizes) {
  Write-Output ("{0}|{1}x{2}" -f $ps.PaperName, $ps.Width, $ps.Height)
}
"#;

/// List active (not-completed) jobs as `Id<TAB>User<TAB>Size<TAB>SubmittedTime`.
#[cfg(target_os = "windows")]
const GET_QUEUE_PS: &str = r#"
param([Parameter(Mandatory=$true)][string]$PrinterName)
$ErrorActionPreference = "SilentlyContinue"
Get-PrintJob -PrinterName $PrinterName | ForEach-Object {
  "{0}`t{1}`t{2}`t{3}" -f $_.Id, $_.UserName, $_.Size, $_.SubmittedTime
}
"#;

/// Remove all jobs from a printer's queue.
#[cfg(target_os = "windows")]
const CLEAR_QUEUE_PS: &str = r#"
param([Parameter(Mandatory=$true)][string]$PrinterName)
$ErrorActionPreference = "Stop"
$jobs = Get-PrintJob -PrinterName $PrinterName -ErrorAction SilentlyContinue
foreach ($j in $jobs) { Remove-PrintJob -InputObject $j -ErrorAction SilentlyContinue }
Write-Output ("Cleared {0} job(s) for {1}" -f @($jobs).Count, $PrinterName)
"#;

/// Resume a paused printer device and un-pause any paused jobs.
#[cfg(target_os = "windows")]
const RESUME_PS: &str = r#"
param([Parameter(Mandatory=$true)][string]$PrinterName)
$ErrorActionPreference = "Stop"
$p = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $PrinterName }
if ($null -eq $p) { throw "Printer not found: '$PrinterName'" }
Invoke-CimMethod -InputObject $p -MethodName Resume | Out-Null
Get-PrintJob -PrinterName $PrinterName -ErrorAction SilentlyContinue | Resume-PrintJob -ErrorAction SilentlyContinue
Write-Output ("Resumed printer {0}" -f $PrinterName)
"#;

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
pub fn print_test_page(printer_name: String, rotate: Option<String>) -> Result<String, String> {
    let rotate_val = rotate.unwrap_or_else(|| "auto".to_string());
    // Windows: never send raw bytes through the printers crate (it can fault a
    // dye-sub driver). Render a GDI text page via PowerShell, timeout-guarded.
    // The test page respects the same rotation so operators can calibrate.
    #[cfg(target_os = "windows")]
    {
        return run_powershell(TEST_PAGE_PS, &["-PrinterName", printer_name.as_str(), "-Rotate", rotate_val.as_str()], 60)
            .map(|out| {
                let t = out.trim();
                if t.is_empty() {
                    format!("Test page sent to printer: {}", printer_name)
                } else {
                    t.to_string()
                }
            })
            .map_err(|e| format!("Test print failed: {}", e));
    }

    // macOS / other: existing printers-crate path (rotation not applied to the
    // text test page here; it's mainly a Windows/DNP calibration aid).
    #[cfg(not(target_os = "windows"))]
    {
    let _ = rotate_val;
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
}

/// Print a photo to the specified printer (or default if not specified)
/// Takes base64 encoded image data (JPEG)
#[command]
pub fn print_photo(image_data: String, printer_name: Option<String>, page_size: Option<String>, rotate: Option<String>) -> Result<String, String> {
    // Manual rotation override from the admin panel: "auto" | "90" | "180" | "270".
    let rotate_val = rotate.unwrap_or_else(|| "auto".to_string());
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
    
    // Determine the target printer name.
    // macOS/other resolve the friendly name to a driver system name via the
    // printers crate. Windows skips this native call entirely (it drives the
    // print through PowerShell, where an empty name means the default printer),
    // so we don't poke the DNP driver more than necessary.
    #[cfg(not(target_os = "windows"))]
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

        // Build the ordered list of media names to try. Some DNP RX-1/RX1HS
        // driver installs advertise the 4x6 size under a name our detection
        // didn't pick (offline at detection time, unusual driver, etc.), which
        // made a single hard-coded media= flag fail the whole print. So we try
        // the resolved name first, then well-known DNP/Gutenprint fallbacks,
        // and finally no media flag at all (let CUPS use the printer default).
        // `Some(name)` => pass `-o media=name`; `None` => omit the media flag.
        let media_attempts: Vec<Option<String>> = match page_size_val.as_str() {
            "A3" => vec![Some("A3".to_string())],
            "A4" => vec![Some("A4".to_string())],
            _ => {
                let mut v: Vec<Option<String>> = vec![Some(cups_media.clone())];
                for fallback in ["w288h432", "4x6", "6x4", "PC-4x6", "Postcard"] {
                    if !v.iter().any(|m| m.as_deref() == Some(fallback)) {
                        v.push(Some(fallback.to_string()));
                    }
                }
                v.push(None); // last resort: printer default media
                v
            }
        };

        let send_media_type = driver_supports_media_type(target_printer_name.as_deref());
        let mut last_err = String::new();
        let mut result: Option<String> = None;

        for attempt in &media_attempts {
            let mut cmd = Command::new("lp");

            // Specify printer if provided (otherwise CUPS uses its default)
            if let Some(ref pname) = target_printer_name {
                cmd.arg("-d").arg(pname);
            }

            if let Some(ref media) = attempt {
                cmd.arg("-o").arg(format!("media={}", media));
            }
            // Only send MediaType on drivers that expose it (Brother inkjets).
            // Dye-sub printers like the DNP RX-1 have no MediaType option and
            // would reject/complain about this, so we skip it for them.
            if send_media_type {
                cmd.arg("-o").arg("MediaType=photographic-glossy");
            }
            cmd.arg("-o").arg("fit-to-page");
            // Manual rotation override from the admin panel. CUPS
            // orientation-requested: 4 = 90°, 5 = 270°, 6 = 180°.
            match rotate_val.as_str() {
                "90" => { cmd.arg("-o").arg("orientation-requested=4"); }
                "180" => { cmd.arg("-o").arg("orientation-requested=6"); }
                "270" => { cmd.arg("-o").arg("orientation-requested=5"); }
                _ => {}
            }
            cmd.arg("-t").arg("Framr Studio Photo");
            cmd.arg(&temp_path);

            match cmd.output() {
                Ok(output) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let printer_label = target_printer_name.as_deref().unwrap_or("default");
                    let media_label = attempt.as_deref().unwrap_or("printer default");
                    result = Some(format!(
                        "Photo sent to printer: {} (Media: {}) — {}",
                        printer_label, media_label, stdout.trim()
                    ));
                    break;
                }
                Ok(output) => {
                    last_err = String::from_utf8_lossy(&output.stderr).trim().to_string();
                }
                Err(e) => {
                    last_err = format!("Failed to execute lp command: {}", e);
                }
            }
        }

        // Clean up temp file (best-effort)
        let _ = fs::remove_file(&temp_path);

        match result {
            Some(msg) => Ok(msg),
            None => Err(format!("lp command failed after trying all media names: {}", last_err)),
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::fs;

        // Empty name => the PowerShell helper prints to the Windows default.
        // The photobooth flow passes null (default printer); a friendly name,
        // if given, is passed through to PrinterSettings.PrinterName as-is.
        let printer_arg = printer_name.clone().unwrap_or_default();

        // Write image bytes to a temp file for GDI rendering.
        let temp_path = std::env::temp_dir()
            .join(format!("chronosnap_print_{}.jpg", chrono::Utc::now().timestamp_millis()));
        fs::write(&temp_path, &image_bytes)
            .map_err(|e| format!("Failed to write temp print file: {}", e))?;

        // On Windows the DNP RX1HS (and every GDI printer) must be driven
        // through the driver's rendering pipeline — raw JPEG bytes sent to the
        // spooler come out blank. We use System.Drawing.Printing via PowerShell
        // to render the image onto the correct paper size (4x6 for 2R/4R).
        let img_path = temp_path.to_string_lossy();
        let result = run_powershell(PRINT_PHOTO_PS, &[
            "-ImagePath", &*img_path,
            "-PrinterName", printer_arg.as_str(),
            "-PageSize", page_size_val.as_str(),
            "-Rotate", rotate_val.as_str(),
        ], 90);

        let _ = fs::remove_file(&temp_path);

        match result {
            Ok(out) => {
                let label = if printer_arg.is_empty() { "default" } else { &printer_arg };
                Ok(format!("Photo sent to printer: {} — {}", label, out.trim()))
            }
            Err(e) => Err(format!("Windows print failed: {}", e)),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (printer_name, page_size_val, image_bytes, target_printer_name, rotate_val);
        Err("Photo printing is only supported on macOS and Windows".to_string())
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

    #[cfg(target_os = "windows")]
    {
        // Pass the name straight to PowerShell (empty = default printer). The
        // frontend already supplies the driver's system name, and PowerShell
        // resolves/validates it — so we avoid an extra native printers-crate
        // call against the DNP driver here. 12s timeout guards a hung driver.
        let name_arg = printer_name.unwrap_or_default();
        let raw = run_powershell(MEDIA_OPTIONS_PS, &["-PrinterName", name_arg.as_str()], 12)?;

        let mut available: Vec<String> = Vec::new();
        let mut resolved_4r: Option<String> = None;
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            // Format: "Name|WIDTHxHEIGHT" (dimensions in 1/100 inch).
            let (name, dims) = match line.rsplit_once('|') {
                Some((n, d)) => (n.trim().to_string(), d.trim()),
                None => (line.to_string(), ""),
            };
            if !name.is_empty() && !available.iter().any(|a| a.eq_ignore_ascii_case(&name)) {
                available.push(name.clone());
            }
            // A 4x6 photo is 400x600 hundredths of an inch (either orientation).
            if resolved_4r.is_none() {
                if let Some((w, h)) = dims.split_once('x') {
                    let w: i32 = w.trim().parse().unwrap_or(0);
                    let h: i32 = h.trim().parse().unwrap_or(0);
                    if (w == 400 && h == 600) || (w == 600 && h == 400) {
                        resolved_4r = Some(name);
                    }
                }
            }
        }

        let env_override = std::env::var("FRAMR_MEDIA_4R").ok().filter(|s| !s.trim().is_empty());
        let supports_4r = resolved_4r.is_some() || env_override.is_some();
        let resolved = env_override
            .or(resolved_4r)
            .unwrap_or_else(|| "4x6".to_string());

        Ok(PrinterMediaInfo {
            available_media: available,
            resolved_4r_media: resolved,
            supports_4r,
            // Windows GDI printing selects paper by size, not a CUPS MediaType.
            supports_media_type: false,
        })
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = printer_name;
        Err("Media inspection is only supported on macOS and Windows".to_string())
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
    
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell(GET_QUEUE_PS, &["-PrinterName", printer_name.as_str()], 12)?;
        let mut jobs = Vec::new();
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            // Tab-separated: Id \t User \t Size \t SubmittedTime
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 4 {
                jobs.push(PrintJobInfo {
                    id: parts[0].trim().to_string(),
                    user: parts[1].trim().to_string(),
                    size: parts[2].trim().to_string(),
                    date: parts[3..].join(" ").trim().to_string(),
                });
            }
        }
        Ok(jobs)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = printer_name;
        Err("Print queue management is only supported on macOS and Windows".to_string())
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
    
    #[cfg(target_os = "windows")]
    {
        let out = run_powershell(CLEAR_QUEUE_PS, &["-PrinterName", printer_name.as_str()], 15)?;
        let msg = out.trim();
        Ok(if msg.is_empty() {
            format!("Cleared print queue for {}", printer_name)
        } else {
            msg.to_string()
        })
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = printer_name;
        Err("Print queue management is only supported on macOS and Windows".to_string())
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
    
    #[cfg(target_os = "windows")]
    {
        let out = run_powershell(RESUME_PS, &["-PrinterName", printer_name.as_str()], 15)?;
        let msg = out.trim();
        Ok(if msg.is_empty() {
            format!("Resumed printer {}", printer_name)
        } else {
            msg.to_string()
        })
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = printer_name;
        Err("Printer resume is only supported on macOS and Windows".to_string())
    }
}
