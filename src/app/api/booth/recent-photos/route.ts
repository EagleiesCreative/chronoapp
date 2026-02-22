import { NextRequest, NextResponse } from 'next/server';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
    try {
        // Authenticate the booth request
        const booth = await getBoothFromRequest(request);
        if (!booth) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '10');

        // Note: we fetch recent sessions. 
        // We use admin client to bypass RLS since we authenticated the booth above.
        const { data, error } = await supabaseAdmin
            .from('sessions')
            .select('final_image_url, created_at')
            .eq('status', 'completed')
            .not('final_image_url', 'is', null)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Database error fetching recent photos:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const urls = data
            .map(session => session.final_image_url)
            .filter((url): url is string => url !== null && url.length > 0);

        return NextResponse.json({ photos: urls });
    } catch (err: any) {
        console.error('Error fetching recent photos:', err);
        return NextResponse.json(
            { error: err.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
