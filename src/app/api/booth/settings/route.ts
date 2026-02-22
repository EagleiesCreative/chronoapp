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
        const { booth_id, background_image, background_color, payment_bypass } = body;

        // Verify the booth_id matches the authenticated booth
        if (booth_id !== booth.booth_id) {
            return NextResponse.json(
                { error: 'Unauthorized to update this booth' },
                { status: 403 }
            );
        }

        const supabase = getSupabaseAdmin();

        const { error } = await supabase
            .from('booths')
            .update({
                background_image: background_image,
                background_color: background_color,
                payment_bypass: payment_bypass,
                updated_at: new Date().toISOString(),
            })
            .eq('id', booth_id);

        if (error) {
            console.error('Error updating booth settings:', error);
            return NextResponse.json(
                { error: 'Failed to update booth settings' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
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

        const { data, error } = await supabase
            .from('booths')
            .select('background_image, background_color, payment_bypass')
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
