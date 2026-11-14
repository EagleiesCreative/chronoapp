'use client';

/**
 * Client-side upload utility for Cloudflare R2 via API Route.
 * 
 * Routes all uploads through the /api/upload endpoint, ensuring 
 * seamless integration with the server's cloud storage backend.
 */


// Vercel rejects request bodies over 4.5 MB before our route runs, and the rejection has no
// CORS headers, so WebKit only reports "TypeError: Load failed". Keep uploads safely below it.
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

/**
 * Downscale/re-encode a JPEG so it fits under MAX_UPLOAD_BYTES. Camera photos (Sony/Canon)
 * are 10–30 MB; 2400px on the long edge is still plenty for the web gallery/share page.
 */
async function shrinkImageForUpload(blob: Blob): Promise<Blob> {
    if (blob.size <= MAX_UPLOAD_BYTES || !blob.type.startsWith('image/') || blob.type === 'image/gif') {
        return blob;
    }
    try {
        const bitmap = await createImageBitmap(blob);
        let maxEdge = 2400;
        let quality = 0.85;
        for (let attempt = 0; attempt < 4; attempt++) {
            const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) break;
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const out = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', quality)
            );
            if (out && out.size <= MAX_UPLOAD_BYTES) {
                bitmap.close?.();
                console.log(
                    `[Upload] Resized ${(blob.size / 1048576).toFixed(1)}MB -> ${(out.size / 1048576).toFixed(1)}MB (${canvas.width}x${canvas.height})`
                );
                return out;
            }
            maxEdge = Math.round(maxEdge * 0.8);
            quality = Math.max(0.7, quality - 0.05);
        }
        bitmap.close?.();
    } catch (err) {
        console.warn('[Upload] Could not resize image, uploading original:', err);
    }
    return blob;
}

/**
 * Upload securely to Cloudflare R2 via API Route proxy with retries.
 */
async function uploadToStorage(
    filePath: string,
    blob: Blob,
    contentType: string,
    maxRetries: number = 3
): Promise<string> {
    let lastError: Error | null = null;
    if (contentType === 'image/jpeg') {
        blob = await shrinkImageForUpload(blob);
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const formData = new FormData();
            let extension = 'jpg';
            if (contentType === 'image/gif') extension = 'gif';
            else if (contentType.includes('mp4')) extension = 'mp4';
            else if (contentType.includes('webm')) extension = 'webm';
            
            formData.append('file', blob, `upload.${extension}`);
            
            // Extract folder from filePath (e.g. "sessions/uuid" from "sessions/uuid/file.jpg")
            // Wait, api/upload route only accepts ['frames', 'photos', 'sessions', 'backgrounds'].
            // Since uploadFinalImageClient sends `sessions/uuid/...`, folder should just be `sessions`.
            const folder = filePath.split('/')[0] || 'photos';
            formData.append('folder', folder);

            // Use apiFetch (not raw fetch): it attaches the `Authorization: Bearer
            // <booth_token>` header. /api/upload requires booth auth, and in the Tauri
            // desktop app there is no cookie for the production domain, so a plain
            // `credentials: 'include'` request is rejected with 401 and the photo is lost.
            const { apiFetch } = await import('@/lib/api');

            const response = await apiFetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json().catch(() => null);
            if (response.ok && data?.success && data?.url) {
                return data.url;
            }
            throw new Error(
                data?.error || `API upload failed (HTTP ${response.status})`
            );
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`[Upload] Attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);

            if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            }
        }
    }

    throw lastError || new Error('Upload failed after all attempts');
}

/**
 * Upload the final composite strip image
 */
export async function uploadFinalImageClient(sessionId: string, blob: Blob): Promise<string> {
    const fileName = `sessions/${sessionId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
    return uploadToStorage(fileName, blob, 'image/jpeg');
}

/**
 * Upload an individual photo
 */
export async function uploadPhotoClient(sessionId: string, photoIndex: number, blob: Blob): Promise<string> {
    const fileName = `sessions/${sessionId}/photo_${photoIndex + 1}_${Date.now()}.jpg`;
    return uploadToStorage(fileName, blob, 'image/jpeg');
}

/**
 * Upload a GIF
 */
export async function uploadGifClient(sessionId: string, blob: Blob): Promise<string> {
    const fileName = `sessions/${sessionId}/stopmotion_${Date.now()}.gif`;
    return uploadToStorage(fileName, blob, 'image/gif');
}

/**
 * Upload a Video (Live Video Mode)
 */
export async function uploadVideoClient(sessionId: string, blob: Blob): Promise<string> {
    const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const fileName = `sessions/${sessionId}/video_${Date.now()}.${extension}`;
    return uploadToStorage(fileName, blob, blob.type || 'video/mp4');
}
