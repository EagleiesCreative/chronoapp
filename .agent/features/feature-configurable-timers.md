# Feature: Configurable Countdown Timers

## Context
The ChronoSnap photobooth has two hardcoded timers:
- **Capture countdown**: `3` seconds (in `CaptureScreen.tsx` line 39)
- **Preview auto-continue**: `5` seconds (in `CaptureScreen.tsx` line 40)
- **Review auto-reset**: `60` seconds (in `ReviewScreen.tsx` line 23)

Booth operators need to adjust these per event (e.g., kids events need longer countdown, corporate events prefer faster flow).

## Requirements
1. Add three configurable timer fields to the booth settings:
   - `countdown_seconds` (default: 3, range: 1–10)
   - `preview_seconds` (default: 5, range: 3–15)
   - `review_timeout_seconds` (default: 60, range: 15–300)
2. Store these values on the `booths` table in Supabase.
3. Expose them via the existing `GET/PATCH /api/booth/settings` route.
4. Read them via `useTenantStore` → `booth` object in the frontend.
5. Add UI controls (sliders or number inputs) in the admin `BackgroundSettings.tsx` panel (which is the booth settings panel).
6. The existing `FloatingSaveBar` should detect changes to these new fields as unsaved changes.

## Files to Modify

### Database
- Add columns to `booths` table:
  ```sql
  ALTER TABLE booths ADD COLUMN IF NOT EXISTS countdown_seconds integer DEFAULT 3;
  ALTER TABLE booths ADD COLUMN IF NOT EXISTS preview_seconds integer DEFAULT 5;
  ALTER TABLE booths ADD COLUMN IF NOT EXISTS review_timeout_seconds integer DEFAULT 60;
  ```

### Backend
- **`src/lib/supabase.ts`** — Add `countdown_seconds`, `preview_seconds`, `review_timeout_seconds` to the `Booth` interface.
- **`src/app/api/booth/settings/route.ts`** — Include the new fields in the `GET` select query and `PATCH` update body.

### Frontend
- **`src/components/admin/BackgroundSettings.tsx`** — Add three slider controls (using the existing `Slider` component from `src/components/ui/slider.tsx`). Group them under a "Timer Settings" section. Include the values in the save payload and `isDirty` calculation.
- **`src/components/booth/CaptureScreen.tsx`** — Replace hardcoded `3` and `5` with `booth?.countdown_seconds ?? 3` and `booth?.preview_seconds ?? 5` from `useTenantStore`.
- **`src/components/booth/ReviewScreen.tsx`** — Replace hardcoded `60` with `booth?.review_timeout_seconds ?? 60` from `useTenantStore`.

## Verification
1. Change countdown to `5s` in admin → capture screen should count down from 5.
2. Change preview to `3s` → photo preview should auto-continue after 3s.
3. Change review timeout to `30s` → review screen should auto-reset after 30s.
4. Discard changes → values should revert.
5. `npm run build` should pass with no errors.
