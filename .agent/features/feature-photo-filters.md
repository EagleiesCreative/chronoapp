# Photo Filters / Effects

## Problem
Users get only the raw camera output — no creative control. Instagram has trained a generation to expect filter options. Offering filters at the booth increases engagement, dwell time, and social sharing.

## Goal
Let users apply **Instagram-style filters** (B&W, Vintage, Warm, Cool, Film, Vivid) to their captured photos before printing/uploading. Filters apply at compositing time so the preview stays fast.

## Design (Senior UX Perspective)

### User Flow
1. After **all photos are captured**, before entering the review screen, a new **"Choose Filter"** step appears
2. Users see their composite preview with a **horizontal filter strip** at the bottom (like Instagram)
3. Tapping a filter applies it in real-time to the preview
4. "No Filter" is always the first/default option
5. Tapping "Apply & Continue" proceeds to the review screen with the selected filter

### Filter Options
| Filter | CSS/Canvas Effect |
|--------|------------------|
| **None** | No changes |
| **B&W** | `grayscale(1)` |
| **Vintage** | `sepia(0.4) contrast(1.1) brightness(0.95)` + warm overlay |
| **Warm** | Slight red/yellow tint: `saturate(1.3) brightness(1.05)` + warm overlay |
| **Cool** | Blue tint: `saturate(0.9) brightness(1.05) hue-rotate(10deg)` |
| **Film** | `contrast(1.2) brightness(0.95) saturate(0.85)` + subtle grain overlay |
| **Vivid** | `saturate(1.5) contrast(1.1)` |

### Technical Approach: Canvas-Based Filters
Filters are applied during the **compositing step** (in `useCompositing.ts`) using canvas `filter` property and pixel manipulation:

```typescript
// Apply CSS-like filter to canvas context before drawing photos
ctx.filter = 'grayscale(1)'; // For B&W
ctx.drawImage(img, ...);
ctx.filter = 'none'; // Reset for frame overlay
```

For overlays (grain, warm tint), draw a semi-transparent colored rectangle after photos but before the frame:
```typescript
// Warm overlay
ctx.fillStyle = 'rgba(255, 200, 100, 0.08)';
ctx.fillRect(0, 0, canvas.width, canvas.height);
```

## Implementation

### New Step in Flow
Add `'filter'` to `BoothStep` type in `booth-store.ts` — inserted between `'capturing'` and `'review'`.

### Files to Create
- `src/components/booth/FilterScreen.tsx` — Filter selection UI with live preview
- `src/lib/photo-filters.ts` — Filter definitions and canvas application logic

### Files to Modify
- `src/store/booth-store.ts` — Add `selectedFilter` state and `'filter'` step
- `src/hooks/useCaptureFlow.ts` — Navigate to `'filter'` instead of `'review'` when all photos captured
- `src/hooks/useCompositing.ts` — Apply selected filter during compositing
- `src/components/booth/BoothLayout.tsx` — Add FilterScreen route

### State Addition
```typescript
// booth-store.ts
selectedFilter: string | null; // Filter name or null for no filter
setSelectedFilter: (filter: string | null) => void;
```
