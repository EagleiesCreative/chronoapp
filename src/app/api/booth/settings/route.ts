import { NextRequest, NextResponse } from 'next/server';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { createClient } from '@supabase/supabase-js';

// Create admin client for updating booth settings
function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available');
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}

// Update booth settings (background, etc.)
export async function PATCH(request: NextRequest) {
    try {
        const booth = await getBoothFromRequest(request);
        if (!booth) {
            return NextResponse.json(
                { error: 'Not authenticated' },
                { status: 401 }
            );
        }

        const body = await request.json();
        const {
            booth_id,
            background_image,
            background_color,
            payment_bypass,
            countdown_seconds,
            preview_seconds,
            live_video_seconds,
            review_timeout_seconds,
            print_copies,
            extra_print_enabled,
            extra_print_price,
            slideshow_enabled,
            brand_logo_url,
            brand_title,
            brand_subtitle,
            brand_primary_color,
            brand_accent_color,
            event_mode,
            event_name,
            event_date,
            event_hashtag,
            event_splash_image,
            event_message,
            gif_enabled,
            print_enabled,
            filter_enabled,
            booth_type,
        } = body;

        // Verify the booth_id matches the authenticated booth
        if (booth_id !== booth.booth_id) {
            return NextResponse.json(
                { error: 'Unauthorized to update this booth' },
                { status: 403 }
            );
        }

        const supabase = getSupabaseAdmin();

        // Price must be a non-negative whole number of rupiah when provided.
        const parsedExtraPrintPrice =
            extra_print_price === undefined || extra_print_price === null
                ? undefined
                : Math.max(0, Math.round(Number(extra_print_price)));

        if (parsedExtraPrintPrice !== undefined && !Number.isFinite(parsedExtraPrintPrice)) {
            return NextResponse.json({ error: 'Invalid extra print price' }, { status: 400 });
        }

        // IMPORTANT: only these columns actually exist on `booths`. Everything
        // else (payment_bypass, countdown/preview/review seconds, print_copies,
        // background_*, brand_*, event_*, slideshow_enabled) lives ONLY on
        // `booth_sessions` and is edited per-session. Previously this update
        // included those session-only fields, so Postgres rejected the whole
        // statement ("column does not exist") and every save showed
        // "Failed to save settings". Undefined entries are dropped so a partial
        // PATCH never clobbers unrelated columns.
        const boothUpdates: Record<string, unknown> = {
            live_video_seconds,
            extra_print_enabled,
            extra_print_price: parsedExtraPrintPrice,
            gif_enabled,
            print_enabled,
            filter_enabled,
            booth_type,
        };
        for (const key of Object.keys(boothUpdates)) {
            if (boothUpdates[key] === undefined) delete boothUpdates[key];
        }

        // Nothing booth-scoped to change (all fields were session-scoped) — the
        // caller will have PATCHed the session separately, so this is a no-op.
        if (Object.keys(boothUpdates).length === 0) {
            return NextResponse.json({ success: true, updated: [] });
        }

        boothUpdates.updated_at = new Date().toISOString();

        const { error } = await supabase
            .from('booths')
            .update(boothUpdates)
            .eq('id', booth_id);

        if (error) {
            console.error('Error updating booth settings:', error);
            return NextResponse.json(
                { error: `Failed to update booth settings: ${error.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true, updated: Object.keys(boothUpdates) });
    } catch (error) {
        console.error('Booth settings error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// Get booth settings
export async function GET(request: NextRequest) {
    try {
        const booth = await getBoothFromRequest(request);
        if (!booth) {
            return NextResponse.json(
                { error: 'Not authenticated' },
                { status: 401 }
            );
        }

        const supabase = getSupabaseAdmin();

        // Only booth-scoped columns exist here; session-scoped settings are read
        // from the active booth_session (see /api/booth/[id]).
        const { data, error } = await supabase
            .from('booths')
            .select('price, live_video_seconds, extra_print_enabled, extra_print_price, gif_enabled, print_enabled, filter_enabled, booth_type')
            .eq('id', booth.booth_id)
            .single();

        if (error) {
            console.error('Error fetching booth settings:', error);
            return NextResponse.json(
                { error: 'Failed to fetch booth settings' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            settings: data,
        });
    } catch (error) {
        console.error('Booth settings error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
