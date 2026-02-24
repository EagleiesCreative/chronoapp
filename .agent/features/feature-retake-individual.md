# Retake Individual Photos

## Problem
Users can currently only retake ALL photos when reviewing their capture session. If one photo out of 3-4 is unflattering, they must redo the entire session — frustrating and time-consuming.

## Goal
Allow users to tap a specific photo slot during the **CaptureScreen preview phase** to re-capture just that one photo, keeping all other captured photos intact.

## Design (Senior UX Perspective)

### User Flow
1. After each photo is captured, the preview phase shows the photo with **Retake** and **Use Photo** buttons (existing)
2. On the **right-side PhotoSlotGrid**, captured photo thumbnails should be **tappable**
3. Tapping a previously-captured thumbnail enters a "retake mode" for that slot:
   - The camera feed resumes on the left
   - A countdown starts for that specific slot
   - The slot in the grid pulses/highlights to show which one is being retaken
   - After capture, the old photo is replaced with the new one
4. The user continues from where they left off (or proceeds to review if all slots are filled)

### Visual Indicators
- Captured thumbnails get a subtle **retake icon overlay** (↺) on hover/tap
- The slot being retaken should have a **colored ring** (e.g., primary color) to distinguish it from the "current next slot"
- Toast or small banner: "Retaking photo 2 of 4"

### Edge Cases
- Can only retake **already-captured** slots (not future ones)
- Retaking resets the preview countdown for that slot
- If the user is in the middle of capturing photo 3 and taps slot 1, pause the current flow, retake slot 1, then resume at slot 3

## Implementation

### Files to Modify
- `src/hooks/useCaptureFlow.ts` — Add `retakePhoto(index)` function, state for `retakingIndex`
- `src/components/booth/PhotoSlotGrid.tsx` — Make captured slots tappable, show retake icon
- `src/components/booth/CaptureScreen.tsx` — Handle retake mode flow

### Key Changes
```typescript
// useCaptureFlow.ts
const [retakingIndex, setRetakingIndex] = useState<number | null>(null);

const retakePhoto = (index: number) => {
    // Save current progress
    setRetakingIndex(index);
    setPhase('countdown');
    setCountdown(booth?.countdown_seconds ?? 3);
};

// When capture completes during retake:
if (retakingIndex !== null) {
    // Replace photo at retakingIndex instead of adding new
    replaceCapturedPhoto(retakingIndex, photoData);
    setRetakingIndex(null);
    // Resume normal flow or go to review if all slots filled
}
```

### New Zustand Action Needed
```typescript
// booth-store.ts
replaceCapturedPhoto: (index: number, photo: CapturedPhoto) => void;
```
