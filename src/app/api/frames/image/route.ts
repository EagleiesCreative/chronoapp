import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/frames/image?url=<encoded_url>
 *
 * Proxy endpoint to serve frame images from external storage (R2, Supabase Storage).
 * Bypasses CORS issues by fetching server-side and serving the binary data.
 *
 * For R2 URLs with expired pre-signed signatures, it strips the query params
 * and retries with the bare URL (works if the bucket has public access enabled).
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const imageUrl = searchParams.get('url');

        if (!imageUrl) {
            return NextResponse.json({ error: 'url parameter is required' }, { status: 400 });
        }

        // Security: only allow known storage URLs
        let urlObj: URL;
        try {
            urlObj = new URL(imageUrl);
        } catch {
            return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
        }

        const hostname = urlObj.hostname.toLowerCase();
        const isR2 = hostname.includes('r2.cloudflarestorage.com');
        const isSupabaseStorage = hostname.includes('supabase.co') || hostname.includes('supabase.in');
        const isEagleies = hostname.includes('eagleies.com');
        const isLocalhost = hostname.includes('localhost') || hostname.includes('127.0.0.1');

        if (!isR2 && !isSupabaseStorage && !isEagleies && !isLocalhost) {
            return NextResponse.json(
                { error: `Hostname ${hostname} is not in the allowed list of storage providers` },
                { status: 403 }
            );
        }

        // --- Attempt 1: Fetch the URL as-is ---
        let response = await fetch(imageUrl, {
            method: 'GET',
            headers: { 'Accept': 'image/*' },
        });

        // --- Attempt 2: For R2, if pre-signed URL expired (403), try unsigned URL ---
        if (!response.ok && isR2 && response.status === 403) {
            console.warn(`R2 pre-signed URL returned 403, trying unsigned URL...`);
            const unsignedUrl = `${urlObj.origin}${urlObj.pathname}`;
            response = await fetch(unsignedUrl, {
                method: 'GET',
                headers: { 'Accept': 'image/*' },
            });
        }

        if (!response.ok) {
            console.error(`Frame image fetch failed: ${response.status} ${response.statusText}`);
            return NextResponse.json(
                { error: `Failed to fetch frame image: ${response.status}` },
                { status: response.status }
            );
        }

        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/png';

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=604800, immutable',
                'Access-Control-Allow-Origin': '*',
            },
        });

    } catch (err: any) {
        console.error('/api/frames/image GET error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
