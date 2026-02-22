'use client';

/**
 * Local save utility for saving photos to disk via Tauri.
 * 
 * All functions gracefully return null/false when Tauri is not available
 * (e.g., running in browser), ensuring the app works in both environments.
 */

/**
 * Check if we're running inside a Tauri application.
 * Tauri v1 sets window.__TAURI__, Tauri v2 sets window.__TAURI_INTERNALS__
 */
export function isTauri(): boolean {
    return typeof window !== 'undefined' && (
        !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__
    );
}

/**
 * Saves a data URL (base64-encoded image) to disk via Tauri invoke.
 * Returns the saved file path, or null if Tauri is not available or save fails.
 */
export async function saveToLocalDisk(
    basePath: string,
    sessionFolder: string,
    fileName: string,
    dataUrl: string,
): Promise<string | null> {
    if (!isTauri()) return null;

    try {
        const { invoke } = await import('@tauri-apps/api/core');

        // Extract base64 data from data URL (strip the "data:image/jpeg;base64," prefix)
        const base64Data = dataUrl.split(',')[1];
        if (!base64Data) throw new Error('Invalid data URL format');

        const dirPath = `${basePath}/${sessionFolder}`;

        const savedPath = await invoke<string>('save_file_to_disk', {
            dirPath,
            fileName,
            dataBase64: base64Data,
        });

        return savedPath;
    } catch (err) {
        console.error('[LocalSave] Failed to save file:', err);
        return null;
    }
}

/**
 * Opens native OS folder picker dialog via Tauri.
 * Returns the selected directory path, or null if cancelled or not in Tauri.
 */
export async function pickSaveDirectory(): Promise<string | null> {
    if (!isTauri()) return null;

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string | null>('pick_directory');
    } catch (err) {
        console.error('[LocalSave] Directory picker failed:', err);
        return null;
    }
}

/**
 * Checks if a directory path exists and is writable.
 * Returns false if not in Tauri or path is not writable.
 */
export async function checkDirectoryWritable(dirPath: string): Promise<boolean> {
    if (!isTauri()) return false;

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('check_directory_writable', { dirPath });
    } catch {
        return false;
    }
}
