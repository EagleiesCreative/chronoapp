import { NextRequest, NextResponse } from 'next/server';
import { getBoothById } from '@/lib/supabase';
import { requireBoothAuth } from '@/lib/booth-auth';

/**
 * GET /api/booth/[id]
 * Get booth information (protected)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // Verify booth authentication
        const authResult = await requireBoothAuth(request);
        if ('error' in authResult) {
            return authResult.error;
        }

        const { id } = await params;

        // Only allow fetching own booth info
        if (authResult.booth.booth_id !== id) {
            return NextResponse.json(
                { error: 'Unauthorized to access this booth' },
                { status: 403 }
            );
        }

        const booth = await getBoothById(id);

        if (!booth) {
            return NextResponse.json(
                { error: 'Booth not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            booth: {
                id: booth.id,
                name: booth.name,
                location: booth.location,
                price: booth.price,
                organization_id: booth.organization_id,
                booth_type: booth.booth_type,
                gif_enabled: booth.gif_enabled,
                print_enabled: booth.print_enabled,
                filter_enabled: booth.filter_enabled,
                background_image: booth.background_image,
                background_color: booth.background_color,
                countdown_seconds: booth.countdown_seconds,
                preview_seconds: booth.preview_seconds,
                review_timeout_seconds: booth.review_timeout_seconds,
                print_copies: booth.print_copies,
                brand_logo_url: booth.brand_logo_url,
                brand_title: booth.brand_title,
                brand_subtitle: booth.brand_subtitle,
                brand_primary_color: booth.brand_primary_color,
                brand_accent_color: booth.brand_accent_color,
                event_mode: booth.event_mode,
                event_name: booth.event_name,
                event_date: booth.event_date,
                event_hashtag: booth.event_hashtag,
                event_splash_image: booth.event_splash_image,
                event_message: booth.event_message,
                slideshow_enabled: booth.slideshow_enabled,
            },
        });
    } catch (error) {
        console.error('Get booth error:', error);
        return NextResponse.json(
            { error: 'Failed to get booth info' },
            { status: 500 }
        );
    }
}
