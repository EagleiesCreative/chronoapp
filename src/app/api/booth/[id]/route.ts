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
