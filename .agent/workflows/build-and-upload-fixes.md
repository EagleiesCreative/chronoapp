---
description: How to maintain Tauri builds and fix CORS/CSP issues for ChronoSnap
---

# Troubleshooting Tauri Builds and Uploads

When building the ChronoSnap Tauri application, it creates a Next.js static export. If you encounter issues where the desktop build is running older code or experiencing "Load failed" upload errors, check these areas:

## 1. Next.js Build Caching (Stale Builds)
**Issue:** The Tauri app builds successfully but runs an older version of your code.
**Cause:** In Next.js, overriding `distDir: 'out'` breaks Next's build cache (`.next`). Next.js will indefinitely reuse the first static export it generated in `out/`.
**Solution:** Do not set `distDir: 'out'` in `next.config.ts`. Next.js automatically outputs to the `out` directory when `output: 'export'` is specified. Ensure `next.config.ts` looks like this:
```typescript
const isTauriBuild = process.env.BUILD_TARGET === 'tauri';
const nextConfig = {
  output: isTauriBuild ? 'export' : undefined,
  // ... no distDir override
};
```

## 2. CORS Headers (Load failed / Network Error)
**Issue:** Cloud requests like `/api/upload` fail with `Load failed` exclusively on the Tauri production build.
**Cause:** The Tauri app runs on a custom protocol origin (e.g., `tauri://localhost`). You must allow this origin dynamically. Statically injecting `Access-Control-Allow-Origin: *` within `vercel.json` conflicts with Next.js's attempts to forward credentials (`credentials: 'include'`). The CORS spec forbids wildcards `*` with credentials.
**Solution:** 
- Rely on `src/proxy.ts` (Next 16 Turbopack's proxy file) to dynamically read the incoming `origin` header and reflect it back in `Access-Control-Allow-Origin`.
- **Never** add `Access-Control-Allow-Origin: *` to `vercel.json` for API routes that accept credentials.

## 3. Content Security Policy (Data URIs blocked)
**Issue:** Capturing or sending images using Data URIs (`data:image/jpeg;base64,...`) fails immediately on the Tauri client.
**Cause:** Tauri's strict WebKit Content Security Policy blocks `fetch()` calls to `data:` and `blob:` unless explicitly permitted.
**Solution:** Ensure `data:` and `blob:` are added to the `connect-src` and `img-src` directives in `src-tauri/tauri.conf.json`:
```json
"security": {
  "csp": "default-src 'self'; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' data: blob: https://*.supabase.co;"
}
```
