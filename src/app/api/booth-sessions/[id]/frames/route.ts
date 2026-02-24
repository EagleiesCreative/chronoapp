import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/booth-sessions/[id]/frames
 * Get frames assigned to a booth session
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const { data, error } = await supabase
            .from('booth_session_frames')
            .select('*, frames(*)')
            .eq('booth_session_id', id)
            .order('sort_order', { ascending: true });

        if (error) throw error;

        return NextResponse.json({ data: data || [] });
    } catch (err: any) {
        console.error('/api/booth-sessions/[id]/frames GET error:', err);
        return NextResponse.json({ error: err.message || 'Failed to fetch frames' }, { status: 500 });
    }
}

/**
 * PUT /api/booth-sessions/[id]/frames
 * Replace all frame assignments for a booth session
 * Body: { frames: [{ frameId, isActive, sortOrder }] }
 */
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();
        const { frames } = body;

        if (!Array.isArray(frames)) {
            return NextResponse.json({ error: 'frames array is required' }, { status: 400 });
        }

        // Delete existing assignments
        const { error: deleteError } = await supabase
            .from('booth_session_frames')
            .delete()
            .eq('booth_session_id', id);

        if (deleteError) throw deleteError;

        // Insert new assignments
        if (frames.length > 0) {
            const rows = frames.map((f: any, index: number) => ({
                booth_session_id: id,
                frame_id: f.frameId,
                is_active: f.isActive !== false,
                sort_order: f.sortOrder ?? index,
            }));

            const { error: insertError } = await supabase
                .from('booth_session_frames')
                .insert(rows);

            if (insertError) throw insertError;
        }

        // Return updated list
        const { data } = await supabase
            .from('booth_session_frames')
            .select('*, frames(*)')
            .eq('booth_session_id', id)
            .order('sort_order', { ascending: true });

        return NextResponse.json({ data: data || [] });
    } catch (err: any) {
        console.error('/api/booth-sessions/[id]/frames PUT error:', err);
        return NextResponse.json({ error: err.message || 'Failed to update frames' }, { status: 500 });
    }
}
