import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/admin-auth';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { uploadBufferToR2 } from '@/lib/r2';

// Allowed file types (images and GIF)
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

// Allowed upload folders (prevents path traversal)
const ALLOWED_FOLDERS = ['frames', 'photos', 'sessions', 'backgrounds'];

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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

        // Validate file type
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json(
                { error: 'Invalid file type. Allowed: PNG, JPG, WEBP' },
                { status: 400 }
            );
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: 'File too large. Maximum size: 5MB' },
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
        const originalExt = file.name.split('.').pop()?.toLowerCase() || 'png';
        const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(originalExt) ? originalExt : 'png';
        const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 10)}.${safeExt}`;

        // Convert File to ArrayBuffer then to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to Cloudflare R2
        const r2Url = await uploadBufferToR2(fileName, buffer, file.type);

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
