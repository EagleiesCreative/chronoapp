import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const BOOTH_COOKIE_NAME = 'chronosnap_booth_session';

// In production, JWT_SECRET must be explicitly set
const jwtSecretEnv = process.env.JWT_SECRET;
if (!jwtSecretEnv && process.env.NODE_ENV === 'production') {
    console.error('[SECURITY WARNING] JWT_SECRET is not set in production! Using insecure default.');
}
const JWT_SECRET = new TextEncoder().encode(
    jwtSecretEnv || 'chronosnap-booth-secret-key-dev-only'
);
const JWT_ISSUER = 'chronosnap';
const JWT_EXPIRY = '7d'; // 7 days

export interface BoothJWTPayload extends JWTPayload {
    booth_id: string;
    booth_name: string;
    organization_id: string;
    device_token: string; // Unique token for this device session
}

/**
 * Generate a unique device token for single-device login
 */
export function generateDeviceToken(): string {
    return uuidv4();
}

/**
 * Sign a new JWT for a booth session
 */
export async function signBoothToken(payload: {
    booth_id: string;
    booth_name: string;
    organization_id: string;
    device_token: string;
}): Promise<string> {
    return new SignJWT({
        booth_id: payload.booth_id,
        booth_name: payload.booth_name,
        organization_id: payload.organization_id,
        device_token: payload.device_token,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setIssuer(JWT_ISSUER)
        .setExpirationTime(JWT_EXPIRY)
        .sign(JWT_SECRET);
}

/**
 * Verify and decode a booth JWT
 */
export async function verifyBoothToken(token: string): Promise<BoothJWTPayload | null> {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET, {
            issuer: JWT_ISSUER,
        });
        return payload as BoothJWTPayload;
    } catch (error) {
        console.error('JWT verification failed:', error);
        return null;
    }
}

/**
 * Set booth session cookie (HttpOnly, Secure)
 */
export async function setBoothSession(token: string): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(BOOTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        // Production (Tauri -> Cloud): Cross-Origin, requires None
        // Development (Localhost): Same-Origin, requires Lax
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
    });
}

/**
 * Get booth session from cookie
 */
export async function getBoothSession(): Promise<BoothJWTPayload | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get(BOOTH_COOKIE_NAME)?.value;

    if (!token) return null;
    return verifyBoothToken(token);
}

/**
 * Clear booth session cookie
 */
export async function clearBoothSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(BOOTH_COOKIE_NAME);
}

/**
 * Get booth ID from request (for API routes)
 * Checks Authorization header first (for Tauri), then falls back to cookie (for web browsers)
 */
export async function getBoothFromRequest(request: NextRequest): Promise<BoothJWTPayload | null> {
    // 1. Check Authorization header first (for Tauri apps)
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
            return await verifyBoothToken(token);
        } catch {
            // Invalid token, fall through to cookie check
        }
    }

    // 2. Fall back to cookie (for web browsers)
    const token = request.cookies.get(BOOTH_COOKIE_NAME)?.value;
    if (!token) return null;
    return verifyBoothToken(token);
}

/**
 * Middleware helper - require booth authentication
 */
export async function requireBoothAuth(
    request: NextRequest
): Promise<{ booth: BoothJWTPayload } | { error: NextResponse }> {
    const booth = await getBoothFromRequest(request);

    if (!booth) {
        return {
            error: NextResponse.json(
                { error: 'Booth authentication required' },
                { status: 401 }
            ),
        };
    }

    return { booth };
}

// Rate limiting for login attempts
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000; // 1 minute

export function checkRateLimit(identifier: string): { allowed: boolean; remainingAttempts: number } {
    const now = Date.now();
    const record = loginAttempts.get(identifier);

    if (!record || now > record.resetAt) {
        loginAttempts.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
        return { allowed: true, remainingAttempts: MAX_ATTEMPTS - 1 };
    }

    if (record.count >= MAX_ATTEMPTS) {
        return { allowed: false, remainingAttempts: 0 };
    }

    record.count++;
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS - record.count };
}


export function resetRateLimit(identifier: string): void {
    loginAttempts.delete(identifier);
}

/**
 * Parse a friendly device name from user agent
 */
export function parseDeviceName(userAgent: string): string {
    // Check for Tauri app
    if (userAgent.includes('Tauri')) {
        return 'ChronoSnap Booth App';
    }

    // Check for common browsers/platforms
    if (userAgent.includes('Windows')) {
        return 'Windows PC';
    } else if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS')) {
        return 'Mac';
    } else if (userAgent.includes('Linux')) {
        return 'Linux PC';
    } else if (userAgent.includes('iPhone')) {
        return 'iPhone';
    } else if (userAgent.includes('iPad')) {
        return 'iPad';
    } else if (userAgent.includes('Android')) {
        return 'Android Device';
    }

    return 'Unknown Device';
}

