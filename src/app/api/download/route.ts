import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/download?url=...
 * 
 * Proxy endpoint to download images from Cloudflare R2 and bypass CORS limitations
 * on the client-side.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const fileUrl = searchParams.get('url');

        if (!fileUrl) {
            return NextResponse.json({ error: 'Missing URL' }, { status: 400 });
        }

        // Security check: Only allow downloads from your R2 domain or Supabase (legacy)
        const allowedDomains = [
            'r2.cloudflarestorage.com',
            'eagleies.com',
            'supabase.co',
            process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL).hostname : null
        ].filter(Boolean);

        const urlHost = new URL(fileUrl).hostname;
        const isAllowed = allowedDomains.some(domain => urlHost.endsWith(domain!));

        if (!isAllowed) {
            return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
        }

        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        const blob = await response.blob();
        
        // Pass through essential headers
        const headers = new Headers();
        headers.set('Content-Type', blob.type || 'application/octet-stream');
        headers.set('Cache-Control', 'public, max-age=3600');
        
        // If filename is provided, set Content-Disposition
        const filename = searchParams.get('filename');
        if (filename) {
            headers.set('Content-Disposition', `attachment; filename="${filename}"`);
        }

        return new Response(blob, {
            status: 200,
            headers,
        });
    } catch (error) {
        console.error('Download proxy error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Download failed' }, 
            { status: 500 }
        );
    }
}
