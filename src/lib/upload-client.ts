'use client';

/**
 * Client-side upload utility for direct Supabase Storage uploads.
 * 
 * This module ONLY uses the public anon key (NEXT_PUBLIC_ env vars),
 * making it safe to import from client components without bundling
 * server-only code.
 * 
 * Falls back to the /api/upload API route if direct upload fails,
 * ensuring uploads work even without Supabase Storage RLS policies.
 */

import { createClient } from '@supabase/supabase-js';

// Create a client-only Supabase instance
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Upload directly to Supabase Storage with retry logic.
 * Falls back to the API route proxy if direct upload fails.
 */
async function uploadToStorage(
    filePath: string,
    blob: Blob,
    contentType: string,
    maxRetries: number = 3
): Promise<string> {
    let lastError: Error | null = null;

    // Attempt 1: Direct Supabase Storage upload (bypasses Vercel body limit)
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const { error } = await supabaseClient.storage
                .from('photos')
                .upload(filePath, blob, {
                    contentType,
                    upsert: true,
                });

            if (error) throw error;

            const { data } = supabaseClient.storage.from('photos').getPublicUrl(filePath);
            return data.publicUrl;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`[Upload] Direct attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);

            if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            }
        }
    }

    // Attempt 2: Fallback to API route proxy (smaller files may work within Vercel limits)
    console.log('[Upload] Falling back to API route proxy...');
    try {
        const formData = new FormData();
        const extension = contentType === 'image/gif' ? 'gif' : 'jpg';
        formData.append('file', blob, `upload.${extension}`);
        // Extract folder from filePath (e.g. "sessions/uuid" from "sessions/uuid/file.jpg")
        const folder = filePath.split('/').slice(0, -1).join('/');
        formData.append('folder', folder);

        const { getApiUrl } = await import('@/lib/api');
        const url = getApiUrl('/api/upload');

        const response = await fetch(url, {
            method: 'POST',
            body: formData,
            credentials: 'include',
        });

        const data = await response.json();
        if (data.success && data.url) {
            return data.url;
        }
        throw new Error(data.error || 'API upload failed');
    } catch (fallbackErr) {
        console.error('[Upload] API fallback also failed:', fallbackErr);
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
