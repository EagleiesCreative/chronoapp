# Accessibility Improvements

## Problem
The photobooth is used in noisy, dimly-lit event environments by users of all ages and abilities. Current touch targets are small, text contrast is insufficient on dark/image backgrounds, and there's no consideration for motor impairment or visual acuity.

## Goal
Improve touch ergonomics and visual contrast across the booth UI to meet kiosk accessibility standards.

## Design (Senior UX Perspective)

### 1. Larger Touch Targets (Minimum 48×48px, target: 64×64px)

**CaptureScreen**
- Retake button: increase from current size to `min-h-[56px] min-w-[140px]`
- Use Photo button: same enlargement
- Add more padding and larger icons (w-5 h-5 → w-6 h-6)

**ReviewScreen**
- Print button: already decent, verify min-height 56px
- New Session button: increase padding

**FrameSelector**
- Frame cards: ensure each card is at least 80×100px touch area
- Navigation arrows (if any): minimum 48×48px

**IdleScreen**
- "Start Session" button: already large, confirm 64px+ height
- "Use Voucher" button: increase to match

### 2. Higher Contrast Text on Dark Backgrounds

**Problem areas:**
- Muted text on slideshow/background-image overlays uses `text-white/40` or `text-white/60` — too low contrast
- Price text on dark backgrounds
- Status messages during capture

**Fix:**
- Minimum opacity for text on dark backgrounds: `text-white/80`
- Add `text-shadow: 0 1px 3px rgba(0,0,0,0.5)` for text over images
- Use `backdrop-blur` + semi-opaque bg behind any text over dynamic content
- Ensure WCAG AA contrast ratio (4.5:1 for normal text, 3:1 for large text)

### 3. Focus States & Feedback

- All interactive elements should have visible focus rings for accessibility
- Add active/pressed states with scale feedback (`active:scale-[0.97]`)
- Ensure buttons have `aria-label` attributes where icon-only

## Implementation

### Files to Modify
- `src/components/booth/CaptureOverlay.tsx` — Enlarge retake/continue buttons
- `src/components/booth/IdleScreen.tsx` — Fix low-contrast text classes
- `src/components/booth/CaptureScreen.tsx` — Verify touch targets
- `src/components/booth/ReviewActions.tsx` — Verify touch targets
- `src/components/booth/FrameSelector.tsx` — Frame card sizing
- `src/app/globals.css` — Add utility class for text-shadow on dark backgrounds

### CSS Utility to Add
```css
/* globals.css */
.text-shadow-dark {
    text-shadow: 0 1px 4px rgba(0,0,0,0.5);
}

.touch-target-lg {
    min-height: 56px;
    min-width: 120px;
}
```

### Contrast Fixes (specific classes to update)
| Current | Replace With |
|---------|-------------|
| `text-white/40` | `text-white/80 text-shadow-dark` |
| `text-white/60` | `text-white/85 text-shadow-dark` |
| `text-muted-foreground/60` | `text-muted-foreground` |
