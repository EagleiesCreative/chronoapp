# Feature: Print Queue / History

## Context
The admin panel currently has no visibility into printing activity. Operators need to:
- See which sessions triggered a print and whether it succeeded.
- Retry failed prints without going back to the review screen.
- Track total prints for paper/ink supply management.

## Requirements
1. Track print jobs locally in a Zustand store (persisted to localStorage).
2. Show a "Print History" section in the admin panel (within the Settings tab, or as a new dedicated section).
3. Each print record should contain:
   - `id` (uuid)
   - `sessionId`
   - `timestamp`
   - `copies` (number requested)
   - `status`: `'printing'` | `'completed'` | `'failed'`
   - `error?`: optional error message
   - `imagePreview`: thumbnail data URL (small, ~50x87px for 2R aspect ratio)
4. Allow "Retry" on failed prints.
5. Show summary stats: total prints today, total prints all-time, failures.
6. Cap history at 200 entries, auto-prune oldest.

## Architecture

### New Store: `src/store/print-store.ts`
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PrintJob {
  id: string;
  sessionId: string;
  timestamp: string;
  copies: number;
  status: 'printing' | 'completed' | 'failed';
  error?: string;
  imagePreview?: string; // small thumbnail
}

interface PrintStore {
  jobs: PrintJob[];
  addJob: (job: PrintJob) => void;
  updateJob: (id: string, updates: Partial<PrintJob>) => void;
  clearHistory: () => void;
  getTodayCount: () => number;
}
```

Use `zustand/middleware` `persist` with `localStorage` key `'chronosnap-print-history'`.

### Modify: `src/components/booth/ReviewScreen.tsx`
In `handlePrint`:
1. Before invoking print, call `addJob({ id, sessionId, timestamp, copies, status: 'printing' })`.
2. On success, call `updateJob(id, { status: 'completed' })`.
3. On failure, call `updateJob(id, { status: 'failed', error: err.message })`.

### New Component: `src/components/admin/PrintHistory.tsx`
- Render inside the admin panel content area (after `PrinterSelector`).
- Show a card with:
  - Header: "Print History" with stats (e.g., "12 prints today · 3 failed").
  - List of recent jobs sorted newest-first, showing:
    - Tiny image thumbnail
    - Timestamp (relative, e.g., "2 min ago")
    - Status badge (green ✅ / red ❌ / yellow ⏳)
    - Retry button for failed jobs
  - "Clear History" button at the bottom.

### Modify: `src/app/page.tsx`
- Import and add `<PrintHistory />` to the admin panel overlay content area (after `<PrinterSelector />`).

### Modify: `src/app/admin/page.tsx`
- Import and add `<PrintHistory />` to the Settings tab content (after `<PrinterSelector />`).

## Files to Create
- `src/store/print-store.ts`
- `src/components/admin/PrintHistory.tsx`

## Files to Modify
- `src/components/booth/ReviewScreen.tsx` — Log print jobs to store.
- `src/app/page.tsx` — Add `<PrintHistory />` to admin overlay.
- `src/app/admin/page.tsx` — Add `<PrintHistory />` to Settings tab.
- `src/components/admin/index.ts` — Export `PrintHistory`.

## Verification
1. Print a photo → entry appears in Print History with "completed" status.
2. Simulate a print failure (disconnect printer) → entry shows "failed" with retry button.
3. Click Retry → new print attempt, original entry updates.
4. Stats show correct counts for today.
5. Close and reopen app → history persists from localStorage.
6. `npm run build` passes.
