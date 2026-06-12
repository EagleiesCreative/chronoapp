import { Redis } from '@upstash/redis';

/**
 * Upstash Redis client (singleton)
 * 
 * Required environment variables:
 *   UPSTASH_REDIS_REST_URL  — from Upstash dashboard
 *   UPSTASH_REDIS_REST_TOKEN — from Upstash dashboard
 * 
 * If not configured, falls back to a no-op client that uses
 * in-memory storage (for local dev without Upstash).
 */

let redis: Redis | null = null;

export function getRedis(): Redis | null {
    if (redis) return redis;

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        if (process.env.NODE_ENV === 'production') {
            console.warn('[Redis] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not set. Admin sessions will not persist across cold starts.');
        }
        return null;
    }

    redis = new Redis({ url, token });
    return redis;
}

// ===== Key Prefixes =====
const ADMIN_TOKEN_PREFIX = 'admin_session:';
const RATE_LIMIT_PREFIX = 'rate_limit:';

// ===== Admin Session Helpers =====

/**
 * Store an admin session token in Redis with TTL
 */
export async function storeAdminToken(token: string, ttlSeconds: number = 86400): Promise<void> {
    try {
        const r = getRedis();
        if (r) {
            await r.set(`${ADMIN_TOKEN_PREFIX}${token}`, '1', { ex: ttlSeconds });
        }
    } catch (err) {
        console.error('[Redis] Failed to store admin token:', err);
    }
}

/**
 * Check if an admin session token exists
 */
export async function hasAdminToken(token: string): Promise<boolean> {
    try {
        const r = getRedis();
        if (r) {
            const result = await r.exists(`${ADMIN_TOKEN_PREFIX}${token}`);
            return result === 1;
        }
    } catch (err) {
        console.error('[Redis] Failed to check admin token:', err);
    }
    return false;
}

/**
 * Remove an admin session token
 */
export async function removeAdminToken(token: string): Promise<void> {
    try {
        const r = getRedis();
        if (r) {
            await r.del(`${ADMIN_TOKEN_PREFIX}${token}`);
        }
    } catch (err) {
        console.error('[Redis] Failed to remove admin token:', err);
    }
}

// ===== Rate Limiting Helpers =====

/**
 * Check and increment rate limit counter
 * Returns { allowed, remaining }
 */
export async function checkRateLimitRedis(
    identifier: string,
    maxAttempts: number = 5,
    windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
    try {
        const r = getRedis();
        if (!r) {
            // Fallback: always allow (in-memory rate limiting still works as backup)
            return { allowed: true, remaining: maxAttempts };
        }

        const key = `${RATE_LIMIT_PREFIX}${identifier}`;
        const current = await r.incr(key);

        // Set TTL on first increment
        if (current === 1) {
            await r.expire(key, windowSeconds);
        }

        const allowed = current <= maxAttempts;
        const remaining = Math.max(0, maxAttempts - current);

        return { allowed, remaining };
    } catch (err) {
        console.error('[Redis] Rate limiting error, falling back to allow:', err);
        return { allowed: true, remaining: maxAttempts };
    }
}

/**
 * Reset rate limit for an identifier
 */
export async function resetRateLimitRedis(identifier: string): Promise<void> {
    try {
        const r = getRedis();
        if (r) {
            await r.del(`${RATE_LIMIT_PREFIX}${identifier}`);
        }
    } catch (err) {
        console.error('[Redis] Failed to reset rate limit:', err);
    }
}
