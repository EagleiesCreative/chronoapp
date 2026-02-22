import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const origin = request.headers.get('origin') ?? '';

    // Next.js middleware handling dynamic CORS for Tauri and Vercel
    const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:1420',   // Default Tauri v2 dev port
        'tauri://localhost',
        'http://tauri.localhost',
        'https://chronosnap.eagleies.com'
    ];

    const isAllowedOrigin =
        allowedOrigins.includes(origin) ||
        origin.startsWith('tauri://') ||
        origin.endsWith('.localhost');

    // For OPTIONS requests, return 200 immediately with CORS headers
    const response = request.method === 'OPTIONS'
        ? new NextResponse(null, { status: 200 })
        : NextResponse.next();

    // If valid origin, attach CORS headers
    if (isAllowedOrigin) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Credentials', 'true');
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token, x-csrf-token, x-requested-with');
    }

    return response;
}

export const config = {
    matcher: '/api/:path*',
};
