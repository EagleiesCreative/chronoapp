import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { storeAdminToken, hasAdminToken, removeAdminToken } from '@/lib/redis';

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

// In-memory fallback when Redis is not configured (local dev)
const localTokens = new Set<string>();

// Session duration in seconds (24 hours)
const SESSION_TTL_SECONDS = 24 * 60 * 60;

function generateSessionToken(): string {
    return randomUUID();
}

/**
 * Verify if the provided PIN is correct
 */
export function verifyPin(pin: string): boolean {
    try {
        const a = Buffer.from(pin);
        const b = Buffer.from(ADMIN_PIN);
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

/**
 * Create an admin session
 */
export async function createSession(): Promise<string> {
    const token = generateSessionToken();
    const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    // Store token in Redis (persists across cold starts) with fallback to in-memory
    try {
        await storeAdminToken(token, SESSION_TTL_SECONDS);
    } catch {
        // Redis unavailable — fall back to in-memory
    }
    localTokens.add(token);

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
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
            return await isTokenValid(adminToken);
        }
    }

    // 2. Fall back to cookie
    try {
        const cookieStore = await cookies();
        const session = cookieStore.get(SESSION_COOKIE);
        if (!session?.value) return false;
        return await isTokenValid(session.value);
    } catch {
        return false;
    }
}

/**
 * Validate a token against Redis (primary) and in-memory (fallback)
 */
async function isTokenValid(token: string): Promise<boolean> {
    // Check in-memory first (fast path)
    if (localTokens.has(token)) return true;

    // Check Redis (survives cold starts)
    try {
        const exists = await hasAdminToken(token);
        if (exists) {
            // Re-populate in-memory cache for subsequent requests in this instance
            localTokens.add(token);
            return true;
        }
    } catch {
        // Redis unavailable — rely on in-memory only
    }

    return false;
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
    try {
        const cookieStore = await cookies();
        const session = cookieStore.get(SESSION_COOKIE);
        if (session?.value) {
            // Remove from both stores
            localTokens.delete(session.value);
            try {
                await removeAdminToken(session.value);
            } catch {
                // Redis unavailable — already removed from in-memory
            }
        }
        cookieStore.delete(SESSION_COOKIE);
    } catch {
        // Ignore errors during cleanup
    }
}

/**
 * Middleware helper to check authentication for API routes
 * Returns null if authenticated, or an error response if not
 */
export async function requireAuth(request: NextRequest): Promise<NextResponse | null> {
    const isAuthenticated = await checkSession(request);

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
    try {
        const a = Buffer.from(apiKey);
        const b = Buffer.from(ADMIN_API_KEY);
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
    } catch {
        return false;
    }
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
    const isAuthenticated = await checkSession(request as unknown as NextRequest);
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

