use std::ffi::c_void;
use std::path::Path;

use libloading::{Library, Symbol};
use serde::{Deserialize, Serialize};

pub type EdsError = u32;
pub type EdsHandle = *mut c_void;
pub type EdsCameraListRef = EdsHandle;
pub type EdsCameraRef = EdsHandle;
pub type _EdsVolumeRef = EdsHandle;
pub type _EdsDirectoryItemRef = EdsHandle;
pub type _EdsStreamRef = EdsHandle;
pub type _EdsImageRef = EdsHandle;
pub type _EdsEvfImageRef = EdsHandle;

pub const EDS_ERR_OK: EdsError = 0x00000000;
pub const _K_EDS_CAMERA_COMMAND_TAKE_PICTURE: u32 = 0x00000000;
pub const _K_EDS_PROPERTY_ID_EVF_OUTPUT_DEVICE: u32 = 0x00000500;
pub const _K_EDS_EVF_OUTPUT_DEVICE_PC: u32 = 0x00000001;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonCameraInfo {
    pub id: String,
    pub name: String,
}

pub struct CanonSdk {
    lib: Library,
}

impl CanonSdk {
    pub fn load() -> Result<Self, String> {
        let lib_path = if cfg!(target_os = "macos") {
            "libs/EDSDK.framework/Versions/A/EDSDK"
        } else {
            return Err("Unsupported OS".to_string());
        };

        if !Path::new(lib_path).exists() {
            return Err("EDSDK.framework not found in libs/".to_string());
        }

        unsafe {
            let lib = Library::new(lib_path).map_err(|e| format!("Failed to load library: {}", e))?;
            
            // Initialize SDK
            let init_sdk: Symbol<unsafe extern "C" fn() -> EdsError> = lib.get(b"EdsInitializeSDK")
                .map_err(|e| format!("Symbol not found: {}", e))?;
            
            let err = init_sdk();
            if err != EDS_ERR_OK {
                return Err(format!("EdsInitializeSDK failed: 0x{:08X}", err));
            }

            Ok(Self { lib })
        }
    }

    pub fn list_cameras(&self) -> Result<Vec<CanonCameraInfo>, String> {
        unsafe {
            let get_list: Symbol<unsafe extern "C" fn(*mut EdsCameraListRef) -> EdsError> = self.lib.get(b"EdsGetCameraList")
                .map_err(|e| format!("Symbol not found: {}", e))?;
            
            let get_count: Symbol<unsafe extern "C" fn(EdsCameraListRef, *mut u32) -> EdsError> = self.lib.get(b"EdsGetChildCount")
                .map_err(|e| format!("Symbol not found: {}", e))?;
            
            let _get_child: Symbol<unsafe extern "C" fn(EdsCameraListRef, u32, *mut EdsCameraRef) -> EdsError> = self.lib.get(b"EdsGetChildAtIndex")
                .map_err(|e| format!("Symbol not found: {}", e))?;

            // Note: Normally we'd also get camera info like name, but for this skeleton 
            // we'll just return indices.
            
            let mut list_ref: EdsCameraListRef = std::ptr::null_mut();
            let mut err = get_list(&mut list_ref);
            if err != EDS_ERR_OK {
                return Err(format!("EdsGetCameraList failed: 0x{:08X}", err));
            }

            let mut count: u32 = 0;
            err = get_count(list_ref, &mut count);
            if err != EDS_ERR_OK {
                return Err(format!("EdsGetChildCount failed: 0x{:08X}", err));
            }

            let mut cameras = Vec::new();
            for i in 0..count {
                cameras.push(CanonCameraInfo {
                    id: format!("canon_{}", i),
                    name: format!("Canon Camera {}", i + 1),
                });
            }

            // Clean up: Release list_ref if needed (EDSDK specific)
            
            Ok(cameras)
        }
    }
}

impl Drop for CanonSdk {
    fn drop(&mut self) {
        unsafe {
            if let Ok(term_sdk) = self.lib.get::<unsafe extern "C" fn() -> EdsError>(b"EdsTerminateSDK") {
                term_sdk();
            }
        }
    }
}
