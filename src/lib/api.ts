/**
 * API Configuration
 * 
 * This utility provides a consistent way to make API calls that work in both:
 * - Local development (localhost:3000)
 * - Production (your Vercel URL)
 * 
 * Set NEXT_PUBLIC_API_URL in .env.local for production:
 * NEXT_PUBLIC_API_URL=https://your-app.vercel.app
 */

// Get API base URL - defaults to relative path (works locally)
export function getApiUrl(path: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';

    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return `${baseUrl}${normalizedPath}`;
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
