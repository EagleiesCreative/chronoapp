import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const origin = request.headers.get('origin');

    // Define allowed origins
    const allowedOrigins = [
        'http://localhost:3000',
        'https://chronosnap.eagleies.com',
        'tauri://localhost',
        'https://tauri.localhost',
        'http://tauri.localhost',
    ];

    // Allow all Vercel preview deployments
    const isVercelPreview = origin && origin.endsWith('.vercel.app');

    // Allow any Tauri origin (they can vary by platform)
    const isTauriOrigin = origin && origin.toLowerCase().includes('tauri');

    // Check if origin is allowed
    const isAllowed = origin && (allowedOrigins.includes(origin) || isVercelPreview || isTauriOrigin);

    // Log for debugging (will appear in Vercel logs)
    console.log('[Middleware] Request:', {
        path: request.nextUrl.pathname,
        origin,
        isTauriOrigin,
        isAllowed,
    });

    // Initial response
    const response = NextResponse.next();

    // Apply CORS headers if allowed
    if (isAllowed) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Credentials', 'true');
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    }

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
        return new NextResponse(null, {
            status: 200,
            headers: response.headers,
        });
    }

    return response;
}

export const config = {
    matcher: '/api/:path*',
};
