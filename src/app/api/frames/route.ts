import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkSession } from '@/lib/admin-auth';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { z } from 'zod';

// Helper to check either admin or booth auth
async function requireAnyAuth(request: NextRequest): Promise<NextResponse | null> {
    try {
        // Check admin session first
        const isAdmin = await checkSession(request);
        if (isAdmin) return null;
    } catch {
        // Admin session check failed, continue to booth check
    }

    try {
        // Check booth JWT
        const booth = await getBoothFromRequest(request);
        if (booth) return null;
    } catch {
        // Booth check failed
    }

    // Neither authenticated
    return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
    );
}

// Validation schemas
const photoSlotSchema = z.object({
    id: z.string(),
    x: z.number().min(0).max(1000),
    y: z.number().min(0).max(1000),
    width: z.number().min(10).max(1000),
    height: z.number().min(10).max(1000),
    rotation: z.number().min(-180).max(180).optional(),
    layer: z.enum(['below', 'above']).optional(),
});

const createFrameSchema = z.object({
    name: z.string().min(1).max(100),
    imageUrl: z.string().url(),
    photoSlots: z.array(photoSlotSchema).min(1),
    price: z.number().min(0).max(10000000).optional().default(0), // Price is now optional (booth-level)
    isActive: z.boolean().optional().default(true),
    isPublic: z.boolean().optional().default(true),
    boothId: z.string().uuid().optional().nullable(),
    canvasWidth: z.number().min(100).max(10000).optional().default(600),
    canvasHeight: z.number().min(100).max(10000).optional().default(1050),
});

const updateFrameSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100).optional(),
    imageUrl: z.string().url().optional(),
    photoSlots: z.array(photoSlotSchema).optional(),
    price: z.number().min(0).max(10000000).optional(),
    isActive: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    boothId: z.string().uuid().optional().nullable(),
    canvasWidth: z.number().min(100).max(10000).optional(),
    canvasHeight: z.number().min(100).max(10000).optional(),
});

// GET frames - filtered by booth access
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

// POST create new frame (protected)
export async function POST(request: NextRequest) {
    // Check authentication
    const authError = await requireAnyAuth(request);
    if (authError) return authError;

    // Get booth session to assign frame to booth
    const boothSession = await getBoothFromRequest(request);
    if (!boothSession) {
        return NextResponse.json(
            { error: 'Booth authentication required to create frames' },
            { status: 401 }
        );
    }

    try {
        const body = await request.json();

        // Validate input
        const result = createFrameSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json(
                { error: 'Invalid input', details: result.error.issues },
                { status: 400 }
            );
        }

        const { name, imageUrl, photoSlots, price, isActive, canvasWidth, canvasHeight } = result.data;

        const { data: frame, error } = await supabase
            .from('frames')
            .insert({
                name,
                image_url: imageUrl,
                photo_slots: photoSlots,
                price,
                is_active: isActive,
                is_public: false, // Booth frames are private by default
                booth_id: boothSession.booth_id, // Assign to current booth
                canvas_width: canvasWidth,
                canvas_height: canvasHeight,
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, frame });
    } catch (error) {
        console.error('Create frame error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to create frame' },
            { status: 500 }
        );
    }
}

// PUT update frame (protected)
export async function PUT(request: NextRequest) {
    // Check authentication
    const authError = await requireAnyAuth(request);
    if (authError) return authError;

    // Get booth session to verify ownership
    const boothSession = await getBoothFromRequest(request);
    if (!boothSession) {
        return NextResponse.json(
            { error: 'Booth authentication required' },
            { status: 401 }
        );
    }

    try {
        const body = await request.json();

        // Validate input
        const result = updateFrameSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json(
                { error: 'Invalid input', details: result.error.issues },
                { status: 400 }
            );
        }

        const { id, name, imageUrl, photoSlots, price, isActive, canvasWidth, canvasHeight } = result.data;

        // Verify booth owns this frame
        const { data: existingFrame } = await supabase
            .from('frames')
            .select('booth_id')
            .eq('id', id)
            .single();

        if (!existingFrame || existingFrame.booth_id !== boothSession.booth_id) {
            return NextResponse.json(
                { error: 'Frame not found or access denied' },
                { status: 403 }
            );
        }

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (name !== undefined) updates.name = name;
        if (imageUrl !== undefined) updates.image_url = imageUrl;
        if (photoSlots !== undefined) updates.photo_slots = photoSlots;
        if (price !== undefined) updates.price = price;
        if (isActive !== undefined) updates.is_active = isActive;
        if (canvasWidth !== undefined) updates.canvas_width = canvasWidth;
        if (canvasHeight !== undefined) updates.canvas_height = canvasHeight;

        const { data: frame, error } = await supabase
            .from('frames')
            .update(updates)
            .eq('id', id)
            .eq('booth_id', boothSession.booth_id) // Extra safety
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, frame });
    } catch (error) {
        console.error('Update frame error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to update frame' },
            { status: 500 }
        );
    }
}

// DELETE frame (protected)
export async function DELETE(request: NextRequest) {
    // Check authentication
    const authError = await requireAnyAuth(request);
    if (authError) return authError;

    // Get booth session to verify ownership
    const boothSession = await getBoothFromRequest(request);
    if (!boothSession) {
        return NextResponse.json(
            { error: 'Booth authentication required' },
            { status: 401 }
        );
    }

    try {
        let id: string | null = null;
        let force = false;

        try {
            const { searchParams } = new URL(request.url);
            id = searchParams.get('id');
            force = searchParams.get('force') === 'true';
        } catch (urlError) {
            // In Tauri dev mode, request.url might be malformed
            console.warn('Failed to parse URL search params:', urlError);
        }

        if (!id) {
            return NextResponse.json(
                { error: 'id is required' },
                { status: 400 }
            );
        }

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            return NextResponse.json(
                { error: 'Invalid frame ID format' },
                { status: 400 }
            );
        }

        // Verify booth owns this frame
        const { data: existingFrame } = await supabase
            .from('frames')
            .select('booth_id')
            .eq('id', id)
            .single();

        if (!existingFrame || existingFrame.booth_id !== boothSession.booth_id) {
            return NextResponse.json(
                { error: 'Frame not found or access denied' },
                { status: 403 }
            );
        }

        // Check for related sessions
        const { count: sessionCount } = await supabase
            .from('sessions')
            .select('*', { count: 'exact', head: true })
            .eq('frame_id', id);

        if (sessionCount && sessionCount > 0) {
            if (!force) {
                return NextResponse.json(
                    {
                        error: `This frame has ${sessionCount} session(s) associated with it. Use force=true to delete anyway.`,
                        hasReferences: true,
                        sessionCount
                    },
                    { status: 409 }
                );
            }

            // Force delete: set frame_id to null on related sessions
            const { error: updateError } = await supabase
                .from('sessions')
                .update({ frame_id: null })
                .eq('frame_id', id);

            if (updateError) {
                console.error('Error clearing session references:', updateError);
            }
        }

        const { error } = await supabase
            .from('frames')
            .delete()
            .eq('id', id)
            .eq('booth_id', boothSession.booth_id); // Extra safety

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete frame error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to delete frame' },
            { status: 500 }
        );
    }
}
