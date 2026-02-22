# Feature: Offline Local Save (Tauri Filesystem Fallback)

## Context

ChronoSnap's current upload pipeline in `ReviewScreen.tsx` → `upload-client.ts` relies entirely on internet connectivity:

1. Composite strip uploads to Supabase Storage via direct client upload
2. Individual photos upload to Supabase Storage
3. GIF is generated and uploaded to Supabase Storage
4. Session is marked complete via `POST /api/session/complete`
5. A share QR code is generated pointing to the web share page

**Problem**: If the internet drops mid-event, the entire post-capture pipeline fails. The operator gets an "Upload Issue" error on the ReviewScreen, and photos exist only in browser memory. If the session resets, photos are permanently lost.

**Solution**: Add a Tauri filesystem fallback that saves all captured assets (composite strip, individual photos, GIF) to a configurable local directory on the computer. This operates as a safety net — when enabled, photos are *always* saved locally regardless of upload success, ensuring zero photo loss.

## Requirements

### Functional
1. **Toggle**: A boolean `local_save_enabled` setting (default: `false`) toggleable from admin settings.
2. **Directory picker**: An admin UI input where the operator selects or types a local directory path (e.g., `/Users/christina/Desktop/ChronoSnap Photos`). Uses Tauri's `dialog.open` API for a native folder picker.
3. **Directory stored locally**: The save path is NOT stored in Supabase (it's machine-specific). Store it in `localStorage` via a Zustand persisted store or in the existing `useAdminStore`.
4. **File structure**: When saving locally, create a subfolder per session using the timestamp:
   ```
   <save_dir>/
   ├── 2026-02-22_14-30-15/
   │   ├── strip.jpg          (composite image)
   │   ├── photo_1.jpg        (individual photo)
   │   ├── photo_2.jpg
   │   ├── photo_3.jpg
   │   └── stopmotion.gif     (if generated)
   ├── 2026-02-22_14-35-42/
   │   ├── strip.jpg
   │   ...
   ```
5. **Timing**: Local save runs IN PARALLEL with the Supabase upload, not as a sequential fallback. This ensures local copies are saved even if upload succeeds.
6. **Non-blocking**: Local save failures should NOT block the user flow. Log errors to console, show a small warning toast if local save fails, but continue normally.
7. **Graceful when no Tauri**: If running in browser (no Tauri runtime), the feature should be disabled and the toggle hidden. Check for `window.__TAURI__` before offering the feature.

### Non-Functional
- Must not slow down the review screen experience.
- Must handle large files (composite images can be 2-5MB).
- Must create directories recursively if they don't exist.

## Architecture

### Rust Backend: New `filesystem.rs` module

Create `src-tauri/src/filesystem.rs` with these Tauri commands:

```rust
use std::fs;
use std::path::PathBuf;
use base64::{Engine as _, engine::general_purpose};

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

#[tauri::command]
pub async fn pick_directory() -> Result<Option<String>, String> {
    // Uses rfd (raw file dialog) crate for native folder picker
    let folder = rfd::FileDialog::new()
        .set_title("Choose save directory for photos")
        .pick_folder();
    
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn check_directory_writable(dir_path: String) -> Result<bool, String> {
    let dir = PathBuf::from(&dir_path);
    if !dir.exists() {
        // Try to create it
        fs::create_dir_all(&dir).map_err(|e| format!("{}", e))?;
    }
    // Test write
    let test_file = dir.join(".chronosnap_test");
    match fs::write(&test_file, b"test") {
        Ok(_) => {
            let _ = fs::remove_file(&test_file);
            Ok(true)
        }
        Err(_) => Ok(false)
    }
}
```

> **Note on `pick_directory`**: The `rfd` crate provides native OS file dialogs. Add it as a dependency in `src-tauri/Cargo.toml`: `rfd = "0.14"`. Alternatively, use `tauri-plugin-dialog` if available in the project's Tauri version — check `Cargo.toml` first to decide.

### Register in `lib.rs`

```rust
mod filesystem;

// Add to invoke_handler:
filesystem::save_file_to_disk,
filesystem::pick_directory,
filesystem::check_directory_writable,
```

### Frontend: Local Save Utility — `src/lib/local-save.ts`

```typescript
'use client';

/**
 * Saves a data URL (base64) to disk via Tauri invoke.
 * Returns the saved file path, or null if Tauri is not available.
 */
export async function saveToLocalDisk(
    basePath: string,
    sessionFolder: string, 
    fileName: string,
    dataUrl: string,
): Promise<string | null> {
    if (typeof window === 'undefined' || !(window as any).__TAURI__) {
        return null;
    }
    
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        
        // Extract base64 data from data URL
        const base64Data = dataUrl.split(',')[1];
        if (!base64Data) throw new Error('Invalid data URL');
        
        const dirPath = `${basePath}/${sessionFolder}`;
        
        const savedPath = await invoke<string>('save_file_to_disk', {
            dirPath,
            fileName,
            dataBase64: base64Data,
        });
        
        return savedPath;
    } catch (err) {
        console.error('[LocalSave] Failed:', err);
        return null;
    }
}

/**
 * Opens native folder picker dialog via Tauri.
 */
export async function pickSaveDirectory(): Promise<string | null> {
    if (typeof window === 'undefined' || !(window as any).__TAURI__) {
        return null;
    }
    
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string | null>('pick_directory');
    } catch (err) {
        console.error('[LocalSave] Directory picker failed:', err);
        return null;
    }
}

/**
 * Checks if a directory path is writable.
 */
export async function checkDirectoryWritable(dirPath: string): Promise<boolean> {
    if (typeof window === 'undefined' || !(window as any).__TAURI__) {
        return false;
    }
    
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('check_directory_writable', { dirPath });
    } catch {
        return false;
    }
}
```

### Admin Store Update: `src/store/booth-store.ts`

Add to `AdminState` interface and store:

```typescript
// Local save settings (persisted via localStorage, not Supabase)
localSaveEnabled: boolean;
setLocalSaveEnabled: (enabled: boolean) => void;
localSavePath: string | null;
setLocalSavePath: (path: string | null) => void;
```

Since `useAdminStore` is NOT persisted currently, either:
- **Option A**: Switch to `zustand/middleware` `persist` for `useAdminStore`.
- **Option B**: Create a separate small persisted store `useLocalSaveStore` just for these two fields.

**Recommend Option B** — keeps it clean and isolated:

```typescript
// src/store/local-save-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LocalSaveStore {
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    savePath: string | null;
    setSavePath: (path: string | null) => void;
}

export const useLocalSaveStore = create<LocalSaveStore>()(
    persist(
        (set) => ({
            enabled: false,
            setEnabled: (enabled) => set({ enabled }),
            savePath: null,
            setSavePath: (path) => set({ savePath: path }),
        }),
        { name: 'chronosnap-local-save' }
    )
);
```

### Admin UI: `src/components/admin/BackgroundSettings.tsx`

Add a new section "Local Photo Backup" with:

1. **Toggle switch** — "Save photos locally" (reads/writes `useLocalSaveStore.enabled`).
2. **Directory input** — Text field showing the current path + a "Browse" button that calls `pickSaveDirectory()`.
3. **Status indicator** — After selecting a path, validate it with `checkDirectoryWritable()` and show ✅ or ❌.
4. **Only visible in Tauri** — Wrap the entire section in a `isTauri` check. Hide in browser mode.
5. **These settings auto-save** (no need for FloatingSaveBar since they go to localStorage, not API). Or, optionally hook into the existing dirty detection.

### Review Screen Integration: `src/components/booth/ReviewScreen.tsx`

In the `uploadAndGenerateQR` function, add a parallel local save alongside the existing Supabase upload:

```typescript
import { saveToLocalDisk } from '@/lib/local-save';
import { useLocalSaveStore } from '@/store/local-save-store';

// Inside the function, after compositing:
const { enabled: localSaveEnabled, savePath } = useLocalSaveStore.getState();

// Generate session folder name from timestamp
const now = new Date();
const sessionFolder = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;

// Run local save in parallel with Supabase upload (non-blocking)
if (localSaveEnabled && savePath) {
    // Save composite strip
    saveToLocalDisk(savePath, sessionFolder, 'strip.jpg', imageDataUrl)
        .then(p => p && console.log('[LocalSave] Strip saved:', p))
        .catch(err => console.error('[LocalSave] Strip save failed:', err));
    
    // Save individual photos
    capturedPhotos.forEach((photo, i) => {
        if (photo.dataUrl) {
            saveToLocalDisk(savePath, sessionFolder, `photo_${i + 1}.jpg`, photo.dataUrl)
                .catch(err => console.error(`[LocalSave] Photo ${i+1} failed:`, err));
        }
    });
    
    // GIF is saved later after generation (add similar call after line ~220)
}
```

The key point: **local saves fire-and-forget in parallel**. They don't await and don't block the Supabase upload path.

## Files to Create
| File | Purpose |
|------|---------|
| `src-tauri/src/filesystem.rs` | Rust commands: save file, pick directory, check writable |
| `src/lib/local-save.ts` | TS wrapper for Tauri filesystem commands |
| `src/store/local-save-store.ts` | Zustand persisted store for local save settings |

## Files to Modify
| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Register `filesystem` module and commands |
| `src-tauri/Cargo.toml` | Add `rfd` (or `tauri-plugin-dialog`) and `base64` crate dependencies |
| `src/components/admin/BackgroundSettings.tsx` | Add "Local Photo Backup" section with toggle, directory picker, status |
| `src/components/booth/ReviewScreen.tsx` | Add parallel local save calls in `uploadAndGenerateQR` |

## Verification
1. **Enable feature** → Toggle on in admin, select a directory (e.g., Desktop/ChronoSnapPhotos).
2. **Take a photo session** → After review screen compositing, check the local directory — should contain a timestamped folder with `strip.jpg`, `photo_1.jpg`, etc.
3. **Disconnect internet** → Supabase upload fails, but local files are saved successfully. Review screen shows upload error but photos are safe on disk.
4. **Reconnect internet** → Next session uploads to Supabase AND saves locally.
5. **Browser mode** → The "Local Photo Backup" section is hidden entirely.
6. **Invalid directory** → Show ❌ "Directory not writable" in admin settings.
7. **Restart app** → Local save settings persist (localStorage).
8. **Performance** → Local save should not add noticeable delay to the review screen.
9. **`npm run build`** passes. **`cargo build`** passes.
