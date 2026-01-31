/**
 * API Configuration
 * 
 * This utility provides a consistent way to make API calls that work in both:
 * - Local development (localhost:3000)
 * - Production (your Vercel URL)
 * - Tauri desktop app (requires NEXT_PUBLIC_API_URL)
 * 
 * Set NEXT_PUBLIC_API_URL in .env.local:
 * NEXT_PUBLIC_API_URL=https://your-app.vercel.app
 */

// Get API base URL - always returns absolute URL
export function getApiUrl(path: string): string {
    // In standard browser environment (not Tauri), prefer relative paths
    // to allow cookies to work correctly across Vercel previews and production
    // (avoids CORS/Third-party cookie issues)
    if (typeof window !== 'undefined' && !('__TAURI__' in window)) {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const fullUrl = normalizedPath;
        // console.log('[API] getApiUrl (Relative):', { fullUrl });
        return fullUrl;
    }

    // Prefer explicit API URL from environment (required for Tauri builds)
    let baseUrl = process.env.NEXT_PUBLIC_API_URL || '';

    // If not set, provide sensible defaults based on runtime context
    if (!baseUrl) {
        if (typeof window !== 'undefined') {
            // If we are here, we are strictly in a Tauri environment
            // because standard browser (non-Tauri) was handled above.

            // If we are in Tauri and no API URL is set:
            // - In development, assume localhost:3000
            // - In production, assume the main production server
            if (process.env.NODE_ENV === 'development') {
                baseUrl = 'http://localhost:3000';
            } else {
                baseUrl = 'https://chronosnap.eagleies.com';
            }
        } else {
            // In non‑browser environments (e.g., server-side) fallback to localhost
            baseUrl = 'http://localhost:3000';
        }
    }

    // Ensure the path starts with a slash
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const fullUrl = `${baseUrl}${normalizedPath}`;
    console.log('[API] getApiUrl:', { baseUrl, path, fullUrl });
    return fullUrl;
}


// Convenience function for fetch with credentials
export async function apiFetch(
    path: string,
    options: RequestInit = {}
): Promise<Response> {
    const url = getApiUrl(path);

    // Detect if we're in Tauri
    const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

    return fetch(url, {
        ...options,
        credentials: 'include', // Always include cookies for auth
        headers: {
            'Content-Type': 'application/json',
            // Add Origin header for Tauri to help CORS
            ...(isTauri && { 'Origin': 'tauri://localhost' }),
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
