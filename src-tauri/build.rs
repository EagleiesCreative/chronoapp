fn main() {
    #[cfg(target_os = "macos")]
    {
        if std::path::Path::new("libs/EDSDK.framework").exists() {
            println!("cargo:rustc-link-search=framework=libs");
            println!("cargo:rustc-link-lib=framework=EDSDK");
        } else {
            println!("cargo:warning=EDSDK.framework not found in src-tauri/libs. Canon SDK integration will be disabled.");
        }
    }
    tauri_build::build()
}
