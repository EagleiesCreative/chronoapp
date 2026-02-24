import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * PUT /api/booth-sessions/[id]/activate
 * Activate a booth session (deactivates the current active one)
 */
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Get the session to find its booth_id
        const { data: session, error: fetchError } = await supabase
            .from('booth_sessions')
            .select('booth_id')
            .eq('id', id)
            .single();

        if (fetchError || !session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        // Deactivate all sessions for this booth
        const { error: deactivateError } = await supabase
            .from('booth_sessions')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('booth_id', session.booth_id);

        if (deactivateError) throw deactivateError;

        // Activate the target session
        const { data: activated, error: activateError } = await supabase
            .from('booth_sessions')
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (activateError) throw activateError;

        return NextResponse.json({ data: activated });
    } catch (err: any) {
        console.error('/api/booth-sessions/[id]/activate PUT error:', err);
        return NextResponse.json({ error: err.message || 'Failed to activate' }, { status: 500 });
    }
}
