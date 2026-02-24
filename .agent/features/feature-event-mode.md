# Event Mode

## Problem
Weddings and corporate events are the highest-revenue photobooth use case. But the generic booth flow doesn't support event-specific customization: no event branding, no hashtag overlay, and no way for guests to find all event photos in one place.

## Goal
A special **Event Mode** that transforms the booth for weddings/events with: a custom splash screen, event hashtag overlay on photos, and a batch gallery page where all event photos are accessible.

## Design (Senior UX Perspective)

### Event Mode Fields (Booth Settings)
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `event_mode` | boolean | false | Enable event mode |
| `event_name` | string | null | e.g., "Sarah & Tom's Wedding" |
| `event_date` | string | null | ISO date of event |
| `event_hashtag` | string | null | e.g., "#SarahAndTom2026" |
| `event_splash_image` | string | null | Custom splash/welcome image URL |
| `event_message` | string | null | e.g., "Thank you for celebrating with us!" |

### User Flow (Event Mode ON)
1. **Idle Screen** — Shows event splash image (full-screen) OR event name overlay with custom message
2. **Capture Flow** — Normal, but the event hashtag is **overlaid on the composite** during compositing
3. **Review Screen** — Shows event message below QR code
4. **Gallery Page** — `/event/[boothId]` page showing ALL photos from the event

### Hashtag Overlay on Composite
During compositing, after drawing the frame overlay but before exporting, draw the hashtag text at the bottom of the canvas:

```typescript
// In useCompositing.ts
if (booth?.event_mode && booth?.event_hashtag) {
    ctx.save();
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(booth.event_hashtag, canvas.width / 2, canvas.height - 30);
    ctx.restore();
}
```

### Event Gallery Page
A new public page at `/event/[boothId]` that:
- Shows event name and date as header
- Fetches all completed sessions for this booth from the event date
- Displays photos in a responsive masonry grid
- Each photo is downloadable

## Implementation

### Files to Create
- `src/app/event/[boothId]/page.tsx` — Event gallery page
- `src/components/event/EventGallery.tsx` — Grid layout for event photos

### Files to Modify
- `src/lib/supabase.ts` — Add event mode fields to `Booth` interface
- `src/app/api/booth/settings/route.ts` — Accept + persist event fields
- `src/hooks/useCompositing.ts` — Draw hashtag overlay when event mode is on
- `src/components/booth/IdleScreen.tsx` — Show event splash/branding when event mode is on
- `src/components/booth/ReviewScreen.tsx` — Show event message
- `src/components/booth/BoothLayout.tsx` — No changes needed (same flow steps)
