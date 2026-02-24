# Custom Branding per Booth

## Problem
Every booth looks the same — generic ChronoSnap branding. Booth owners at weddings, corporate events, and branded activations want **their logo**, **their colors**, and **their name** front and center.

## Goal
Let booth owners upload a **custom logo**, set an **app title**, and choose **primary/accent colors** via the admin settings — transforming the booth into their brand identity.

## Design (Senior UX Perspective)

### Branding Fields (Booth Settings)
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `brand_logo_url` | string | null | URL to uploaded logo (shown on idle screen + review) |
| `brand_title` | string | 'ChronoSnap' | Custom app title on idle screen |
| `brand_subtitle` | string | 'Capture your moments...' | Tagline below title |
| `brand_primary_color` | string | '#8B7355' | Primary color (buttons, accents) |
| `brand_accent_color` | string | '#C4A77D' | Accent color (highlights) |

### Where Branding Appears
1. **IdleScreen** — Custom logo replaces camera icon, custom title replaces "ChronoSnap"
2. **ReviewScreen** — Logo appears small in the corner
3. **QR Share Page** — Branded header
4. **Buttons** — Use brand primary color

### Color Application
Instead of hardcoding CSS variables, dynamically inject brand colors as CSS custom properties on the booth container. This means ALL existing `text-primary`, `bg-primary` classes automatically pick up the brand color.

```tsx
// In BoothLayout.tsx or a wrapper
<div style={{
    '--primary': hexToHSL(booth.brand_primary_color),
    '--ring': hexToHSL(booth.brand_primary_color),
} as React.CSSProperties}>
```

## Implementation

### Files to Modify
- `src/lib/supabase.ts` — Add branding fields to `Booth` interface
- `src/app/api/booth/settings/route.ts` — Accept + persist branding fields
- `src/components/booth/IdleScreen.tsx` — Render custom logo, title, subtitle
- `src/components/booth/BoothLayout.tsx` — Apply dynamic CSS variables from booth config
- `src/components/booth/ReviewScreen.tsx` — Show small logo if configured

### No Database Migration Required
The fields can be stored as JSONB or as individual columns. Since Supabase is flexible, adding columns is straightforward. The TypeScript interface update is the main change needed.
