import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/frames/image?url=<encoded_url>
 *
 * Proxy endpoint to serve frame images from R2 storage.
 * This bypasses CORS issues by fetching server-side and serving the binary data.
 *
 * Usage in browser:
 *   /api/frames/image?url=https://...r2.cloudflarestorage.com/frames/...
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const imageUrl = searchParams.get('url');

        if (!imageUrl) {
            return NextResponse.json(
                { error: 'url parameter is required' },
                { status: 400 }
            );
        }

        // Validate the URL is a Cloudflare R2 URL (security check)
        const urlObj = new URL(imageUrl);
        const hostname = urlObj.hostname;

        if (!hostname.includes('r2.cloudflarestorage.com') && !hostname.includes('localhost')) {
            return NextResponse.json(
                { error: 'Only Cloudflare R2 URLs are supported' },
                { status: 403 }
            );
        }

        // Fetch the image from R2
        const response = await fetch(imageUrl, {
            method: 'GET',
            headers: {
                'Accept': 'image/*',
            },
        });

        if (!response.ok) {
            console.error(`Frame image fetch failed: ${response.status} ${response.statusText}`);
            return NextResponse.json(
                { error: 'Failed to fetch frame image' },
                { status: response.status }
            );
        }

        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/png';

        // Return the image with CORS headers so browser can use it in canvas
        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
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
