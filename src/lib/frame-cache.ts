import { Frame } from '@/lib/supabase';
import { getAssetUrl } from '@/lib/api';

const DB_NAME = 'ChronoSnapDB';
const STORE_NAME = 'frame_images';
const METADATA_KEY = 'chronosnap_frames_metadata';

// --- METADATA (Kept in LocalStorage for sync access) ---

export function getCachedFrames(): Frame[] {
    try {
        if (typeof window === 'undefined') return [];
        const cached = localStorage.getItem(METADATA_KEY);
        if (cached) return JSON.parse(cached);
    } catch {
        // ignore
    }
    return [];
}

export function setCachedFrames(frames: Frame[]): void {
    try {
        if (typeof window === 'undefined') return;
        localStorage.setItem(METADATA_KEY, JSON.stringify(frames));
    } catch {
        // ignore
    }
}

// --- IMAGES (Moved to IndexedDB to bypass 5MB limit) ---

function getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getCachedImageUrl(originalUrl: string): Promise<string | null> {
    if (typeof window === 'undefined' || !originalUrl) return null;
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(originalUrl);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('Failed to read from IndexedDB', err);
        return null;
    }
}

async function setCachedImageUrl(originalUrl: string, base64: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(base64, originalUrl);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('Failed to write to IndexedDB', err);
    }
}

async function fetchImageAsBase64(url: string): Promise<string> {
    const response = await fetch(getAssetUrl(url), {
        mode: 'cors',
        credentials: 'omit'
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function cacheFrameImages(frames: Frame[]): Promise<void> {
    if (typeof window === 'undefined') return;
    for (const frame of frames) {
        if (!frame.image_url) continue;
        try {
            const base64 = await fetchImageAsBase64(frame.image_url);
            await setCachedImageUrl(frame.image_url, base64);
        } catch (err) {
            console.warn(`[FrameCache] Failed to cache image for frame ${frame.name}`, err);
        }
    }
}
