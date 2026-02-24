import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/booth-sessions/[id]
 * Get a single booth session with its frame assignments
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const { data, error } = await supabase
            .from('booth_sessions')
            .select('*, booth_session_frames(*, frames(*))')
            .eq('id', id)
            .single();

        if (error) throw error;

        return NextResponse.json({ data });
    } catch (err: any) {
        console.error('/api/booth-sessions/[id] GET error:', err);
        return NextResponse.json({ error: err.message || 'Not found' }, { status: 404 });
    }
}

/**
 * PATCH /api/booth-sessions/[id]
 * Update a booth session's settings
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();

        // Remove fields that shouldn't be directly updated
        const { boothId, frameIds, booth_id, ...updates } = body;

        const { data, error } = await supabase
            .from('booth_sessions')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ data });
    } catch (err: any) {
        console.error('/api/booth-sessions/[id] PATCH error:', err);
        return NextResponse.json({ error: err.message || 'Failed to update' }, { status: 500 });
    }
}

/**
 * DELETE /api/booth-sessions/[id]
 * Delete a booth session (cannot delete active session)
 */
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Check if session is active
        const { data: session } = await supabase
            .from('booth_sessions')
            .select('is_active')
            .eq('id', id)
            .single();

        if (session?.is_active) {
            return NextResponse.json(
                { error: 'Cannot delete the active session. Activate another session first.' },
                { status: 400 }
            );
        }

        const { error } = await supabase
            .from('booth_sessions')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('/api/booth-sessions/[id] DELETE error:', err);
        return NextResponse.json({ error: err.message || 'Failed to delete' }, { status: 500 });
    }
}
