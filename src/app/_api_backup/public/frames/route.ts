import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/public/frames
 *
 * Public endpoint for external/standalone apps to fetch frames.
 * Authenticates via `booth_token` query parameter (matches booths.device_token).
 * Optionally filters by `session_id` to get session-specific frames.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const boothToken = searchParams.get('booth_token');
        const sessionId = searchParams.get('session_id');

        // 1. Require booth_token
        if (!boothToken) {
            return NextResponse.json(
                { error: 'booth_token is required' },
                { status: 401 }
            );
        }

        // 2. Look up booth by device_token
        const { data: booth, error: boothError } = await supabase
            .from('booths')
            .select('id, name, booth_id, organization_id, status, device_token')
            .eq('device_token', boothToken)
            .maybeSingle();

        if (boothError) {
            console.error('/api/public/frames GET — booth lookup error:', boothError);
            return NextResponse.json(
                { error: 'Internal server error' },
                { status: 500 }
            );
        }

        if (!booth) {
            return NextResponse.json(
                { error: 'Invalid booth token' },
                { status: 403 }
            );
        }

        // 3. Verify booth is active
        if (booth.status !== 'active') {
            return NextResponse.json(
                { error: 'Booth is not active' },
                { status: 403 }
            );
        }

        // 4. Fetch frames
        let frames: any[] = [];

        if (sessionId) {
            // Session-specific: get frames linked via booth_session_frames
            const { data: sessionFrames, error: sfError } = await supabase
                .from('booth_session_frames')
                .select('frame_id, is_active, sort_order, frames(*)')
                .eq('booth_session_id', sessionId)
                .eq('is_active', true)
                .order('sort_order', { ascending: true });

            if (sfError) {
                console.error('/api/public/frames GET — session frames error:', sfError);
            }

            if (sessionFrames && sessionFrames.length > 0) {
                frames = sessionFrames
                    .map((sf: any) => sf.frames)
                    .filter((f: any) => f && f.is_active);
            }
        }

        // If no session frames found (or no session_id), fall back to booth + public frames
        if (frames.length === 0) {
            const { data: boothFrames, error: framesError } = await supabase
                .from('frames')
                .select('*')
                .eq('is_active', true)
                .or(`booth_id.eq.${booth.id},and(is_public.eq.true,booth_id.is.null)`)
                .order('created_at', { ascending: false });

            if (framesError) {
                console.error('/api/public/frames GET — frames query error:', framesError);
                return NextResponse.json(
                    { error: 'Failed to fetch frames' },
                    { status: 500 }
                );
            }

            frames = boothFrames || [];
        }

        // 5. Format response per integration guide spec
        const formattedFrames = frames.map((frame: any) => ({
            id: frame.id,
            name: frame.name,
            image_url: frame.image_url,
            canvas_width: frame.canvas_width || 600,
            canvas_height: frame.canvas_height || 1050,
            price: frame.price || 0,
            is_active: frame.is_active,
            booth_id: frame.booth_id || null,
            booth_session_id: frame.booth_session_id || null,
            photo_slots: (frame.photo_slots || []).map((slot: any, index: number) => ({
                id: slot.id,
                x: slot.x,
                y: slot.y,
                width: slot.width,
                height: slot.height,
                rotation: slot.rotation || 0,
                layer: slot.layer || 'below',
                capture_index: slot.capture_index ?? index,
            })),
        }));

        return NextResponse.json({
            booth: {
                id: booth.id,
                name: booth.name,
                booth_id: booth.booth_id,
            },
            frames: formattedFrames,
        });
    } catch (err: any) {
        console.error('/api/public/frames GET error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
