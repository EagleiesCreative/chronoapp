import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getBoothFromRequest } from '@/lib/booth-auth';

/**
 * POST /api/booth-sessions/[id]/duplicate
 * Duplicate a booth session with all settings and frame assignments
 * SECURITY: Requires booth JWT auth
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const boothAuth = await getBoothFromRequest(req);
        if (!boothAuth) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const { id } = await params;

        // Fetch the source session
        const { data: source, error: fetchError } = await supabase
            .from('booth_sessions')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !source) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        // Create duplicate (inactive, with "(Copy)" suffix)
        const { id: _id, created_at, updated_at, is_active, ...settings } = source;
        const { data: duplicate, error: insertError } = await supabase
            .from('booth_sessions')
            .insert({
                ...settings,
                name: `${source.name} (Copy)`,
                is_active: false,
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // Duplicate frame assignments
        const { data: sourceFrames } = await supabase
            .from('booth_session_frames')
            .select('frame_id, is_active, sort_order')
            .eq('booth_session_id', id);

        if (sourceFrames && sourceFrames.length > 0) {
            const frameRows = sourceFrames.map((f: any) => ({
                booth_session_id: duplicate.id,
                frame_id: f.frame_id,
                is_active: f.is_active,
                sort_order: f.sort_order,
            }));

            await supabase.from('booth_session_frames').insert(frameRows);
        }

        return NextResponse.json({ data: duplicate }, { status: 201 });
    } catch (err: any) {
        console.error('/api/booth-sessions/[id]/duplicate POST error:', err);
        return NextResponse.json({ error: err.message || 'Failed to duplicate' }, { status: 500 });
    }
}
