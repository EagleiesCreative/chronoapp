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
    // Prefer explicit API URL from environment (required for Tauri builds)
    let baseUrl = process.env.NEXT_PUBLIC_API_URL || '';

    // If not set, provide sensible defaults based on runtime context
    if (!baseUrl) {
        // In a browser (dev server) we can use the current origin
        if (typeof window !== 'undefined') {
            baseUrl = window.location.origin;
        } else {
            // In non‑browser environments (e.g., Tauri dev mode) fallback to localhost
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
    return response.json();
}
