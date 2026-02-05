import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireAuth } from '@/lib/admin-auth';

// Allowed file types (images and GIF)
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

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

        // For admin uploads (frames folder), require authentication
        if (folder === 'frames') {
            const authError = await requireAuth(request);
            if (authError) return authError;
        }

        // Sanitize filename - only allow alphanumeric, dots, and hyphens
        const originalExt = file.name.split('.').pop()?.toLowerCase() || 'png';
        const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(originalExt) ? originalExt : 'png';
        const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 10)}.${safeExt}`;

        // Convert File to ArrayBuffer then to Buffer for Supabase
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to Supabase Storage (using admin client to bypass RLS)
        const { error: uploadError } = await supabaseAdmin.storage
            .from('photos')
            .upload(fileName, buffer, {
                contentType: file.type,
                upsert: true,
            });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data } = supabaseAdmin.storage.from('photos').getPublicUrl(fileName);

        return NextResponse.json({
            success: true,
            url: data.publicUrl,
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
