import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isR2Configured, uploadBufferToR2 } from '@/lib/r2';

const dataUrlPattern = /^data:([\w/+.-]+);base64,(.+)$/;

const syncPayloadSchema = z.object({
    sessionId: z.string().uuid(),
    boothId: z.string().uuid(),
    finalImageDataUrl: z.string().optional().nullable(),
    photoDataUrls: z.array(z.string()).default([]),
    gifDataUrl: z.string().optional().nullable(),
    contactEmail: z.string().email().optional().nullable(),
    contactPhone: z.string().max(40).optional().nullable(),
    createdAt: z.string().optional().nullable(),
});

const syncEnvelopeSchema = z.object({
    jobId: z.string().min(8),
    payload: syncPayloadSchema,
});

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer; extension: string } {
    const match = dataUrl.match(dataUrlPattern);
    if (!match) {
        throw new Error('Invalid data URL payload');
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const bytes = Buffer.from(base64Data, 'base64');

    let extension = 'jpg';
    if (mimeType.includes('png')) extension = 'png';
    if (mimeType.includes('webp')) extension = 'webp';
    if (mimeType.includes('gif')) extension = 'gif';

    return { mimeType, bytes, extension };
}

async function uploadBinary(
    key: string,
    bytes: Buffer,
    mimeType: string
): Promise<string> {
    if (isR2Configured()) {
        return uploadBufferToR2(key, bytes, mimeType);
    }

    const { error } = await supabaseAdmin.storage
        .from('photos')
        .upload(key, bytes, {
            contentType: mimeType,
            upsert: true,
        });

    if (error) {
        throw new Error(`Supabase upload failed: ${error.message}`);
    }

    const { data } = supabaseAdmin.storage.from('photos').getPublicUrl(key);
    return data.publicUrl;
}

/**
 * POST /api/reliability/sync
 * Internal endpoint called by Tauri Rust background worker.
 * Syncs locally queued booth sessions into cloud storage + Supabase.
 */
export async function POST(request: NextRequest) {
    try {
        const expectedSecret = process.env.RELIABILITY_SYNC_SECRET;
        if (expectedSecret) {
            const receivedSecret = request.headers.get('x-sync-secret');
            if (receivedSecret !== expectedSecret) {
                return NextResponse.json({ error: 'Unauthorized sync request' }, { status: 401 });
            }
        }

        const body = await request.json();
        const validation = syncEnvelopeSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const { payload } = validation.data;

        const photosUrls: string[] = [];
        let finalImageUrl: string | null = null;
        let videoUrl: string | null = null;

        if (payload.finalImageDataUrl) {
            const parsed = parseDataUrl(payload.finalImageDataUrl);
            const key = `sessions/${payload.sessionId}/strip_${Date.now()}.${parsed.extension}`;
            finalImageUrl = await uploadBinary(key, parsed.bytes, parsed.mimeType);
        }

        for (let i = 0; i < payload.photoDataUrls.length; i++) {
            const photo = payload.photoDataUrls[i];
            if (!photo) continue;
            const parsed = parseDataUrl(photo);
            const key = `sessions/${payload.sessionId}/photo_${i + 1}_${Date.now()}.${parsed.extension}`;
            const url = await uploadBinary(key, parsed.bytes, parsed.mimeType);
            photosUrls.push(url);
        }

        if (payload.gifDataUrl) {
            const parsed = parseDataUrl(payload.gifDataUrl);
            const key = `sessions/${payload.sessionId}/stopmotion_${Date.now()}.${parsed.extension}`;
            videoUrl = await uploadBinary(key, parsed.bytes, parsed.mimeType);
        }

        const updates: Record<string, unknown> = {
            booth_id: payload.boothId,
            status: 'completed',
            updated_at: new Date().toISOString(),
        };

        if (finalImageUrl) updates.final_image_url = finalImageUrl;
        if (photosUrls.length > 0) updates.photos_urls = photosUrls;
        if (videoUrl) updates.video_url = videoUrl;

        const { error: sessionError } = await supabaseAdmin
            .from('sessions')
            .update(updates)
            .eq('id', payload.sessionId);

        if (sessionError) {
            throw new Error(`Session update failed: ${sessionError.message}`);
        }

        if (payload.contactEmail || payload.contactPhone) {
            const { error: contactError } = await supabaseAdmin
                .from('session_contacts')
                .upsert(
                    {
                        session_id: payload.sessionId,
                        booth_id: payload.boothId,
                        email: payload.contactEmail || null,
                        phone: payload.contactPhone || null,
                        source: 'offline_sync',
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'session_id' }
                );

            if (contactError) {
                throw new Error(`Contact sync failed: ${contactError.message}`);
            }
        }

        return NextResponse.json({
            success: true,
            sessionId: payload.sessionId,
            finalImageUrl,
            photosCount: photosUrls.length,
            videoUrl,
            storage: isR2Configured() ? 'r2' : 'supabase',
        });
    } catch (error) {
        console.error('Reliability sync error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Sync failed' },
            { status: 500 }
        );
    }
}
