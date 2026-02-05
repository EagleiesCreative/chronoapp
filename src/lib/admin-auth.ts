import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

// Admin PIN from environment variable - required in production
const adminPinEnv = process.env.ADMIN_PIN;
if (!adminPinEnv && process.env.NODE_ENV === 'production') {
    console.error('[SECURITY WARNING] ADMIN_PIN is not set in production! Using insecure default.');
}
const ADMIN_PIN = adminPinEnv || '1234';

// Session cookie name
const SESSION_COOKIE = 'chronosnap_admin_session';

// Session duration: 24 hours
const SESSION_DURATION = 24 * 60 * 60 * 1000;

/**
 * Generate a simple session token
 */
function generateSessionToken(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}_${random}`;
}

/**
 * Verify if the provided PIN is correct
 */
export function verifyPin(pin: string): boolean {
    return pin === ADMIN_PIN;
}

/**
 * Create an admin session
 */
export async function createSession(): Promise<string> {
    const token = generateSessionToken();
    const expires = new Date(Date.now() + SESSION_DURATION);

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        // Production (Tauri -> Cloud): Cross-Origin, requires None
        // Development (Localhost): Same-Origin, requires Lax
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        expires,
        path: '/',
    });

    return token;
}

/**
 * Check if an admin session exists
 * Supports both cookie and X-Admin-Token header
 */
export async function checkSession(request?: NextRequest): Promise<boolean> {
    // 1. Check header if request is provided
    if (request) {
        const adminToken = request.headers.get('x-admin-token');
        if (adminToken) {
            // In this simple implementation, the token IS the session record
            // Real production might check this against a database or cache
            return true;
        }
    }

    // 2. Fall back to cookie
    try {
        const cookieStore = await cookies();
        const session = cookieStore.get(SESSION_COOKIE);
        return !!session?.value;
    } catch {
        return false;
    }
}

/**
 * Get admin token from request
 */
export async function getAdminFromRequest(request: NextRequest): Promise<string | null> {
    const headerToken = request.headers.get('x-admin-token');
    if (headerToken) return headerToken;

    const cookieToken = request.cookies.get(SESSION_COOKIE)?.value;
    return cookieToken || null;
}

/**
 * Clear the admin session
 */
export async function clearSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
}

/**
 * Middleware helper to check authentication for API routes
 * Returns null if authenticated, or an error response if not
 */
export async function requireAuth(): Promise<NextResponse | null> {
    const isAuthenticated = await checkSession();

    if (!isAuthenticated) {
        return NextResponse.json(
            { error: 'Unauthorized. Please login to admin panel.' },
            { status: 401 }
        );
    }

    return null;
}

// API Key from environment variable (for external API access)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

/**
 * Check if API key is valid
 */
export function verifyApiKey(apiKey: string | null): boolean {
    if (!ADMIN_API_KEY || !apiKey) return false;
    return apiKey === ADMIN_API_KEY;
}

/**
 * Middleware helper that accepts EITHER cookie auth OR API key
 * Use this for APIs that need to be accessible from external apps (Postman, dashboards)
 */
export async function requireAuthWithApiKey(request: Request): Promise<NextResponse | null> {
    // First check API key header
    const apiKey = request.headers.get('X-API-Key');
    if (apiKey && verifyApiKey(apiKey)) {
        return null; // Authenticated via API key
    }

    // Fall back to cookie session
    const isAuthenticated = await checkSession();
    if (isAuthenticated) {
        return null; // Authenticated via cookie
    }

    return NextResponse.json(
        { error: 'Unauthorized. Provide X-API-Key header or login to admin panel.' },
        { status: 401 }
    );
}

/**
 * Check if admin is configured (PIN is set)
 */
export function isAdminConfigured(): boolean {
    return !!process.env.ADMIN_PIN;
}

