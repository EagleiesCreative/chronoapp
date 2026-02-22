# Feature: Idle Screen Slideshow / Attract Mode

## Context
The idle screen currently shows a static background (color or image). At events, showing a rotating slideshow of recent photos taken at the booth attracts more customers. This "attract mode" is a standard feature in professional photo booths.

## Requirements
1. Add a toggle setting `slideshow_enabled` (boolean, default false) to booth settings.
2. When enabled, the idle screen background cycles through recent completed session photos.
3. Fetch the latest N (e.g., 10) completed sessions' `final_image_url` from the API.
4. Cross-fade between images every 5 seconds with smooth animation.
5. Overlay the existing UI (ChronoSnap title, Start Session button) on top of the slideshow with a dark overlay for readability.
6. If no recent photos exist or slideshow is disabled, fall back to the normal static background.
7. The slideshow should NOT interfere with the booth flow — it only runs on the idle screen.

## Architecture

### Database
```sql
ALTER TABLE booths ADD COLUMN IF NOT EXISTS slideshow_enabled boolean DEFAULT false;
```

### Backend
- **`src/lib/supabase.ts`** — Add `slideshow_enabled?: boolean` to `Booth` interface.
- **`src/app/api/booth/settings/route.ts`** — Include `slideshow_enabled` in GET/PATCH.
- **New API route: `src/app/api/booth/recent-photos/route.ts`** — Returns the latest 10 `final_image_url` values from completed sessions for the current booth:
  ```typescript
  // GET /api/booth/recent-photos
  const { data } = await supabase
    .from('sessions')
    .select('final_image_url')
    .eq('booth_id', booth.id)
    .eq('status', 'completed')
    .not('final_image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);
  ```

### Frontend

#### Admin Settings: `src/components/admin/BackgroundSettings.tsx`
- Add a "Slideshow Mode" toggle switch (similar to Payment Bypass).
- Description: "Show recent photos as a slideshow on the idle screen".
- Include in save payload, `isDirty`, and `handleDiscard`.

#### Idle Screen: `src/components/booth/IdleScreen.tsx`
- If `booth.slideshow_enabled` is true, fetch recent photos from `/api/booth/recent-photos` on mount.
- Render a `<SlideshowBackground />` subcomponent that:
  - Preloads all images.
  - Uses `AnimatePresence` with `framer-motion` to cross-fade between images every 5 seconds.
  - Falls back to the static background if no images are fetched or on error.
- The dark overlay (`bg-black/30`) should always be present when slideshow is active for text readability.

#### New Component: `src/components/booth/SlideshowBackground.tsx`
```typescript
interface SlideshowBackgroundProps {
  imageUrls: string[];
  intervalMs?: number; // default 5000
}
```
- Cycles through `imageUrls` using `useState` index + `useEffect` interval.
- Uses two stacked `<img>` elements with `framer-motion` `AnimatePresence` for cross-fade.
- Each image fills the container with `object-cover`.

## Files to Create
- `src/app/api/booth/recent-photos/route.ts`
- `src/components/booth/SlideshowBackground.tsx`

## Files to Modify
- `src/lib/supabase.ts` — Add `slideshow_enabled` to `Booth`.
- `src/app/api/booth/settings/route.ts` — Include `slideshow_enabled`.
- `src/components/admin/BackgroundSettings.tsx` — Add toggle + dirty detection.
- `src/components/booth/IdleScreen.tsx` — Conditionally render slideshow background.

## Verification
1. Enable slideshow in admin → idle screen shows rotating recent photos.
2. Disable slideshow → idle screen reverts to static background.
3. No recent photos in DB → falls back to static background gracefully.
4. Slideshow cross-fades smoothly (no flicker or jump).
5. All text remains readable with dark overlay.
6. Navigating away from idle (Start Session) stops the slideshow; returning to idle restarts it.
7. `npm run build` passes.
