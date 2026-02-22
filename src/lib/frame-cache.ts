import { Frame } from '@/lib/supabase';
import { getAssetUrl } from '@/lib/api';

const FRAMES_CACHE_KEY = 'chronosnap_frames_metadata';
const FRAMES_IMAGE_PREFIX = 'chronosnap_frame_img_';

export function getCachedFrames(): Frame[] {
    try {
        if (typeof window === 'undefined') return [];
        const cached = localStorage.getItem(FRAMES_CACHE_KEY);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (err) {
        console.warn('Failed to parse cached frames', err);
    }
    return [];
}

export function setCachedFrames(frames: Frame[]): void {
    try {
        if (typeof window === 'undefined') return;
        localStorage.setItem(FRAMES_CACHE_KEY, JSON.stringify(frames));
    } catch (err) {
        console.warn('Failed to save frames to cache', err);
    }
}

export function getCachedImageUrl(originalUrl: string): string | null {
    try {
        if (typeof window === 'undefined') return null;
        if (!originalUrl) return null;
        return localStorage.getItem(FRAMES_IMAGE_PREFIX + originalUrl);
    } catch {
        return null;
    }
}

async function fetchImageAsBase64(url: string): Promise<string> {
    const response = await fetch(getAssetUrl(url));
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

        const cacheKey = FRAMES_IMAGE_PREFIX + frame.image_url;

        try {
            const base64 = await fetchImageAsBase64(frame.image_url);
            localStorage.setItem(cacheKey, base64);
        } catch (err) {
            console.warn(`Failed to cache image for frame ${frame.name}`, err);
            // Ignore offline/fetch errors and just try the next frame
        }
    }
}
