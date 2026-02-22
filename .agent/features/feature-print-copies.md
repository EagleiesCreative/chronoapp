# Feature: Print Copies Setting

## Context
The `ReviewScreen.tsx` has a `handlePrint` function that prints the composite photo via Tauri's `invoke('print_image', ...)` command. Currently there is no way to control how many copies are printed. Booth operators need this to:
- Set a default number of copies per session (e.g., 2 for weddings).
- Optionally allow customers to choose the number of copies on the review screen.

## Requirements
1. Add a `print_copies` field to the `booths` table (integer, default: 1, range: 1–5).
2. Expose it via `GET/PATCH /api/booth/settings`.
3. Add a slider or number stepper in the admin settings panel.
4. On the Review Screen, show the configured number of copies as a label near the Print button (e.g., "Print Photo (×2)").
5. When `handlePrint` is called, loop the Tauri print command `print_copies` times, or pass the copies count to the Rust backend if supported.
6. Include `print_copies` in the `FloatingSaveBar` dirty detection.

## Files to Modify

### Database
```sql
ALTER TABLE booths ADD COLUMN IF NOT EXISTS print_copies integer DEFAULT 1;
```

### Backend
- **`src/lib/supabase.ts`** — Add `print_copies?: number` to `Booth` interface.
- **`src/app/api/booth/settings/route.ts`** — Include `print_copies` in GET select and PATCH update.

### Frontend
- **`src/components/admin/BackgroundSettings.tsx`** — Add a "Print Copies" slider (1–5) under a "Print Settings" section. Include in `isDirty` and `handleDiscard`.
- **`src/components/booth/ReviewScreen.tsx`**:
  - Import `useTenantStore` and read `booth.print_copies`.
  - Update Print button label: `Print Photo (×{copies})` when copies > 1.
  - In `handlePrint`, loop the print invoke call `copies` times with a small delay between each (e.g., 500ms) to avoid job collision, or pass a `copies` param to the Rust command if the printer driver supports it.

### Rust (optional enhancement)
- **`src-tauri/src/printer.rs`** — If the underlying print API supports a copies parameter, accept it from the JS invoke call. Otherwise the JS loop approach works fine.

## Verification
1. Set copies to 3 in admin → Print button should say "Print Photo (×3)".
2. Click Print → printer should receive 3 print jobs (or 1 job with 3 copies).
3. Set copies to 1 → Print button should say "Print Photo" (no multiplier shown).
4. `npm run build` should pass.
