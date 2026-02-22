# Feature: Booth Status Indicator

## Context
When a booth is running, operators currently have no way to see at a glance if everything is healthy (API connected, camera ready, printer online). They have to open the admin panel and test each device individually. A small status indicator on the idle screen would let operators quickly diagnose issues.

## Requirements
1. Show a small, unobtrusive status dot/badge on the idle screen corner.
2. Monitor three subsystems:
   - **API / Internet** — Ping `/api/health` every 30s. Green if 200, red if failed.
   - **Camera** — Check `navigator.mediaDevices.enumerateDevices()` for video inputs. Green if ≥1 camera found, red if none.
   - **Printer** — Check via Tauri invoke `list_printers`. Green if ≥1 printer found, yellow if no Tauri (browser-only mode), red if Tauri present but no printers.
3. Tapping/clicking the indicator opens a small popover with details per subsystem.
4. The indicator should NOT distract customers. Use a tiny dot (8px) in the bottom-left corner that only booth operators would notice.

## Architecture

### New Hook: `src/hooks/useBoothHealth.ts`
Create a custom hook that runs periodic health checks and returns:
```typescript
interface BoothHealth {
  api: 'ok' | 'error' | 'checking';
  camera: 'ok' | 'error' | 'checking';
  printer: 'ok' | 'warning' | 'error' | 'checking';
  overall: 'ok' | 'degraded' | 'error';
  lastChecked: Date;
  checkNow: () => void;
}
```

- Run checks on mount and every 30 seconds.
- `overall` is `ok` if all green, `degraded` if any yellow, `error` if any red.

### New Component: `src/components/booth/BoothStatusIndicator.tsx`
- Renders a small colored dot (green/yellow/red) based on `overall`.
- On click/tap, shows a popover or small card with:
  - API: ✅ Connected / ❌ Disconnected
  - Camera: ✅ Ready / ❌ Not found
  - Printer: ✅ Ready / ⚠️ Not available / ❌ Offline
  - Last checked: "5s ago"
- Positioned `fixed bottom-4 left-4` with `z-index` below the admin panel.

### Integration: `src/components/booth/IdleScreen.tsx`
- Import and render `<BoothStatusIndicator />` inside the idle screen.
- Only show on idle screen (not during capture/review).

## Files to Create
- `src/hooks/useBoothHealth.ts`
- `src/components/booth/BoothStatusIndicator.tsx`

## Files to Modify
- `src/components/booth/IdleScreen.tsx` — Add `<BoothStatusIndicator />`.

## Verification
1. Start app with camera and API available → green dot.
2. Disconnect internet → dot turns red, popover shows "API: ❌".
3. Block camera permission → dot turns red, popover shows "Camera: ❌".
4. Run in browser (no Tauri) → printer shows warning (yellow), not error.
5. Tap the dot → details popover opens. Tap again → closes.
6. `npm run build` passes.
