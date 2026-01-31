import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';

const completeSessionSchema = z.object({
    sessionId: z.string().uuid(),
    finalImageUrl: z.string().url(),
    photosUrls: z.array(z.string().url()).optional(),
    videoUrl: z.string().url().optional().nullable(),
});

/**
 * POST /api/session/complete
 * Mark a session as completed with final image and optional video
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const validation = completeSessionSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const { sessionId, finalImageUrl, photosUrls, videoUrl } = validation.data;

        // Update session with final image, video, and mark as completed
        const updates: Record<string, unknown> = {
            final_image_url: finalImageUrl,
            status: 'completed',
            updated_at: new Date().toISOString(),
        };

        if (photosUrls && photosUrls.length > 0) {
            updates.photos_urls = photosUrls;
        }

        if (videoUrl) {
            updates.video_url = videoUrl;
        }

        const { error } = await supabase
            .from('sessions')
            .update(updates)
            .eq('id', sessionId);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Complete session error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to complete session' },
            { status: 500 }
        );
    }
}
