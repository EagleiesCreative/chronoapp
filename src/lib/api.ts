/**
 * API Configuration
 * 
 * This utility provides a consistent way to make API calls that work in both:
 * - Local development (localhost:3000)
 * - Production (your Vercel URL)
 * - Tauri desktop app (requires NEXT_PUBLIC_API_URL)
 */

// Production API URL - hardcoded to ensure it's bundled
const PRODUCTION_API_URL = 'https://chronosnap.eagleies.com';

// Detect if running in Tauri environment
function isTauriEnvironment(): boolean {
    if (typeof window === 'undefined') return false;

    // Check for Tauri-specific properties
    if ('__TAURI__' in window) return true;
    if ('__TAURI_INTERNALS__' in window) return true;

    // Check URL protocol - Tauri uses tauri:// or http://tauri.localhost
    const protocol = window.location.protocol;
    const host = window.location.host;

    if (protocol === 'tauri:') return true;
    if (host === 'tauri.localhost') return true;

    // Check if NOT running on a standard web server
    // In Tauri, the origin will be tauri://localhost or similar
    const origin = window.location.origin;
    if (origin.includes('tauri')) return true;

    // Check for localhost with non-standard port (Tauri dev mode)
    // But NOT localhost:3000 which is the Next.js dev server
    if (protocol === 'http:' && host === 'localhost:3000') return false;

    // If we're not on a recognized web origin, assume Tauri
    const isStandardWeb =
        protocol === 'https:' ||
        (protocol === 'http:' && (host.includes('localhost') || host.includes('127.0.0.1')));

    if (!isStandardWeb) return true;

    return false;
}

// Get API base URL
export function getApiUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    // Server-side rendering - use localhost
    if (typeof window === 'undefined') {
        return `http://localhost:3000${normalizedPath}`;
    }

    // Force localhost in development mode, even for Tauri
    // This ensures dev app talks to dev server, not production
    if (process.env.NODE_ENV === 'development') {
        const devUrl = 'http://localhost:3000';
        return `${devUrl}${normalizedPath}`;
    }

    // Check if we're in Tauri
    const inTauri = isTauriEnvironment();
    console.log('[API] Environment check:', {
        inTauri,
        protocol: window.location.protocol,
        host: window.location.host,
        origin: window.location.origin
    });

    // Standard browser - use relative paths for same-origin requests
    if (!inTauri) {
        return normalizedPath;
    }

    // Tauri environment - always use full production URL
    const fullUrl = `${PRODUCTION_API_URL}${normalizedPath}`;
    console.log('[API] Tauri mode - using:', fullUrl);
    return fullUrl;
}


// Convenience function for fetch with credentials
export async function apiFetch(
    path: string,
    options: RequestInit = {}
): Promise<Response> {
    const url = getApiUrl(path);

    return fetch(url, {
        ...options,
        credentials: 'include', // Always include cookies for auth
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
}

// Type-safe API response handler
export async function apiJson<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const response = await apiFetch(path, options);
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (error) {
        console.error('[API] JSON Parse Error:', error);
        console.error('[API] URL:', response.url);
        console.error('[API] Status:', response.status);
        console.error('[API] Response Text:', text);
        throw error;
    }
}
