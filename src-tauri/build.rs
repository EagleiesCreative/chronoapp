fn main() {
    #[cfg(target_os = "macos")]
    {
        // Canon EDSDK
        if std::path::Path::new("libs/EDSDK.framework").exists() {
            // Loaded dynamically at runtime via libloading (see canon.rs), so we
            // only add the search path and deliberately do NOT hard-link the
            // framework — that keeps Canon support optional, exactly like Sony.
            println!("cargo:rustc-link-search=framework=libs");
        } else {
            println!("cargo:warning=EDSDK.framework not found in src-tauri/libs. Canon SDK integration will be disabled.");
        }

        // Sony CrSDK bridge
        if std::path::Path::new("libs/libsony_bridge.dylib").exists() {
            println!("cargo:rustc-link-search=native=libs");
            // Note: We use libloading for dynamic loading at runtime,
            // so we don't need cargo:rustc-link-lib here.
            // This search path is for runtime discovery.
        } else {
            println!("cargo:warning=libsony_bridge.dylib not found in src-tauri/libs. Sony SDK integration will be disabled.");
        }

        if std::path::Path::new("libs/CrSDK/lib").exists() {
            println!("cargo:rustc-link-search=native=libs/CrSDK/lib");
        }
    }
    tauri_build::build()
}
