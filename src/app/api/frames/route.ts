import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getBoothFromRequest } from '@/lib/booth-auth';

/**
 * GET /api/frames
 *
 * Read-only endpoint — frames are created/managed in the dashboard.
 * This endpoint fetches frames for the authenticated booth.
 */
export async function GET(request: NextRequest) {
    try {
        // Get authenticated booth (required for booth-specific frames)
        const boothSession = await getBoothFromRequest(request);

        let query = supabase
            .from('frames')
            .select('*')
            .order('created_at', { ascending: false });

        // If booth is authenticated, show ONLY frames for this booth
        if (boothSession) {
            query = query.eq('booth_id', boothSession.booth_id);
        } else {
            // Unauthenticated: only show public frames (is_public = true AND booth_id is null)
            query = query.eq('is_public', true).is('booth_id', null);
        }

        const { data: frames, error } = await query;

        if (error) throw error;

        return NextResponse.json({ success: true, frames });
    } catch (error) {
        console.error('Get frames error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to get frames' },
            { status: 500 }
        );
    }
}
