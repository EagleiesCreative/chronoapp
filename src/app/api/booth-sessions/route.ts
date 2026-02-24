import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/booth-sessions?boothId=xxx
 * List all booth sessions for a booth
 */
export async function GET(req: NextRequest) {
    try {
        const boothId = req.nextUrl.searchParams.get('boothId');
        if (!boothId) {
            return NextResponse.json({ error: 'boothId is required' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('booth_sessions')
            .select('*, booth_session_frames(frame_id)')
            .eq('booth_id', boothId)
            .order('is_active', { ascending: false })
            .order('name', { ascending: true });

        if (error) throw error;

        // Also get photo session count per booth session
        const sessionsWithCounts = await Promise.all(
            (data || []).map(async (bs: any) => {
                const { count } = await supabase
                    .from('sessions')
                    .select('*', { count: 'exact', head: true })
                    .eq('booth_session_id', bs.id)
                    .eq('status', 'completed');
                return { ...bs, photo_count: count || 0 };
            })
        );

        return NextResponse.json({ data: sessionsWithCounts });
    } catch (err: any) {
        console.error('/api/booth-sessions GET error:', err);
        return NextResponse.json({ error: err.message || 'Failed to fetch booth sessions' }, { status: 500 });
    }
}

/**
 * POST /api/booth-sessions
 * Create a new booth session
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { boothId, name, frameIds, ...settings } = body;

        if (!boothId || !name) {
            return NextResponse.json({ error: 'boothId and name are required' }, { status: 400 });
        }

        // Insert booth session
        const { data: session, error } = await supabase
            .from('booth_sessions')
            .insert({
                booth_id: boothId,
                name,
                is_active: false,
                ...settings,
            })
            .select()
            .single();

        if (error) throw error;

        // Insert frame assignments if provided
        if (frameIds && Array.isArray(frameIds) && frameIds.length > 0) {
            const frameRows = frameIds.map((frameId: string, index: number) => ({
                booth_session_id: session.id,
                frame_id: frameId,
                is_active: true,
                sort_order: index,
            }));

            const { error: frameError } = await supabase
                .from('booth_session_frames')
                .insert(frameRows);

            if (frameError) {
                console.error('Error inserting frame assignments:', frameError);
            }
        }

        return NextResponse.json({ data: session }, { status: 201 });
    } catch (err: any) {
        console.error('/api/booth-sessions POST error:', err);
        return NextResponse.json({ error: err.message || 'Failed to create booth session' }, { status: 500 });
    }
}
