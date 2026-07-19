import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/admin-auth';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { uploadBufferToR2 } from '@/lib/r2';

// Allowed file types (images, GIF, and Live Video clips).
// NOTE: the video types are required — Live Video Mode uploads a composited
// .webm/.mp4 through this same endpoint. Without them the upload 400s and the
// booth silently falls back to a GIF.
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/webm', 'video/mp4', 'video/quicktime'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

// Allowed upload folders (prevents path traversal)
const ALLOWED_FOLDERS = ['frames', 'photos', 'sessions', 'backgrounds'];

// Max file size. Video is allowed to be larger than a still image.
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 25 * 1024 * 1024; // 25MB

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const folder = formData.get('folder') as string || 'frames';

        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        // Normalise the MIME type before checking it: MediaRecorder blobs can arrive as
        // "video/webm;codecs=vp8,opus", which would fail an exact-match whitelist.
        const mimeType = (file.type || '').split(';')[0].trim().toLowerCase();

        // Validate file type
        if (!ALLOWED_TYPES.includes(mimeType)) {
            return NextResponse.json(
                {
                    error: `Invalid file type "${file.type || 'unknown'}". ` +
                        `Allowed: ${ALLOWED_TYPES.join(', ')}`,
                },
                { status: 400 }
            );
        }

        // Validate file size (videos get a larger allowance than stills)
        const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);
        const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
        if (file.size > maxSize) {
            return NextResponse.json(
                {
                    error: `File too large. Maximum size: ${Math.round(maxSize / (1024 * 1024))}MB ` +
                        `(received ${(file.size / (1024 * 1024)).toFixed(1)}MB)`,
                },
                { status: 400 }
            );
        }

        // Validate folder against whitelist
        if (!ALLOWED_FOLDERS.includes(folder)) {
            return NextResponse.json(
                { error: `Invalid folder. Allowed: ${ALLOWED_FOLDERS.join(', ')}` },
                { status: 400 }
            );
        }

        // For admin uploads (frames folder), require admin authentication
        if (folder === 'frames') {
            const authError = await requireAuth(request);
            if (authError) return authError;
        } else {
            // For other folders, require at least booth authentication
            const boothSession = await getBoothFromRequest(request);
            if (!boothSession) {
                return NextResponse.json(
                    { error: 'Authentication required' },
                    { status: 401 }
                );
            }
        }

        // Sanitize filename - only allow alphanumeric, dots, and hyphens
        // Keep video extensions intact — forcing a .webm/.mp4 to ".png" would make the
        // share page treat a real Live Video as an image and render it with <img>.
        const originalExt = file.name.split('.').pop()?.toLowerCase() || 'png';
        const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'webm', 'mp4', 'mov'].includes(originalExt)
            ? originalExt
            : (isVideo ? 'webm' : 'png');
        const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 10)}.${safeExt}`;

        // Convert File to ArrayBuffer then to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to Cloudflare R2
        // Store with the normalised MIME type so the object serves a clean
        // Content-Type (e.g. "video/webm" rather than "video/webm;codecs=vp8").
        const r2Url = await uploadBufferToR2(fileName, buffer, mimeType);

        return NextResponse.json({
            success: true,
            url: r2Url,
            fileName,
        });
    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to upload file' },
            { status: 500 }
        );
    }
}
