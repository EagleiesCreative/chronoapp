'use client';

/**
 * Client-side upload utility for Cloudflare R2 via API Route.
 * 
 * Routes all uploads through the /api/upload endpoint, ensuring 
 * seamless integration with the server's cloud storage backend.
 */


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
