# Attract Loop / Dynamic Screensaver

## Problem
The idle screen slideshow is functional but static. Modern kiosks use eye-catching animations to draw attention and increase conversion from passerby to paying customer.

## Goal
Replace/enhance the idle screen with a dynamic **attract mode** that uses floating recent photos, subtle particle effects, and bold configurable call-to-action text.

## Design (Senior UX Perspective)

### Visual Elements

1. **Floating Photo Bubbles**
   - Pull recent session photos from local cache or Supabase
   - Display 6-8 photos as semi-transparent, slowly floating circles/rounded-rects
   - Random speeds, directions, and slight rotation wobble
   - Photos should gently bounce off screen edges
   - Opacity: 40-60% so they don't overwhelm the CTA

2. **Particle Background**
   - Subtle bokeh-style light particles floating upward
   - Use CSS animations or canvas-based particles (keep lightweight)
   - Match booth's theme color for particle tint

3. **Call-to-Action**
   - Large, animated text: **"Tap to Start!"** (or configurable via booth settings)
   - Gentle scale pulse animation (1.0 → 1.05 → 1.0)
   - Below: price display and voucher button (keep existing functionality)

4. **Smooth Transition**
   - When user taps anywhere (or the Start button), transition smoothly into frame selection

### Configuration (Admin Settings)
- `attract_text`: string (default: "Tap to Start!")
- `attract_show_recent_photos`: boolean (default: true)
- `attract_particle_enabled`: boolean (default: true)

## Implementation

### Files to Create
- `src/components/booth/AttractLoop.tsx` — The floating photos + particles component
- `src/components/booth/FloatingPhoto.tsx` — Individual floating photo bubble

### Files to Modify
- `src/components/booth/IdleScreen.tsx` — Integrate AttractLoop behind CTA
- `src/store/booth-store.ts` — (optional) cache recent photo URLs

### Animation Approach
- Use **framer-motion** for floating photo positions and CTA pulse
- CSS keyframes for particle effects (lighter weight than canvas)
- `useEffect` to fetch 6-8 recent session thumbnails from `/api/session/recent` or from local IndexedDB cache

### Performance Notes
- Limit to 8 floating photos max
- Use `will-change: transform` for GPU acceleration
- Lazy-load images with small thumbnail sizes (200x200)
- Pause animation when not on idle screen
