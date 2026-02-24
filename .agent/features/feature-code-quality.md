# Code Quality Improvements

## 1. Extract Large Components

### ReviewScreen.tsx (625+ lines)
Split into smaller, focused modules:
- **`hooks/useCompositing.ts`** — Extract the canvas compositing logic (`compositeImages()`) that draws photos into frame slots and generates the final image
- **`hooks/useUploadSession.ts`** — Extract `uploadAndGenerateQR()`, individual photo uploads, GIF generation, and QR code creation
- **`hooks/usePrintHandler.ts`** — Extract `handlePrint()` with Tauri invoke, fallback browser printing, and print job logging
- **`components/booth/ReviewActions.tsx`** — Extract the bottom action buttons (Print, New Session, Download) into a standalone component
- **`components/booth/ReviewQRCode.tsx`** — Extract the QR code display and upload status indicator

### CaptureScreen.tsx (400+ lines)
Split into:
- **`hooks/useCaptureFlow.ts`** — Extract the countdown → capture → preview state machine, including timer logic and phase transitions
- **`components/booth/PhotoSlotGrid.tsx`** — Extract the photo slot grid rendering (the mini-preview of captured/pending slots)
- **`components/booth/CaptureOverlay.tsx`** — Extract the countdown number overlay and flash animation

## 2. Add React Error Boundaries

Create an `ErrorBoundary` component and wrap critical sections:

```tsx
// components/booth/BoothErrorBoundary.tsx
class BoothErrorBoundary extends React.Component {
  // Catches render errors in the booth flow
  // Shows a friendly "Something went wrong" screen with a "Return to Home" button
  // Logs error details to console (and optionally to a remote error tracker)
  // Calls resetSession() on recovery to return to idle state
}
```

Wrap these areas:
- The entire booth flow inside `BoothLayout.tsx`
- The camera/capture section specifically (camera failures shouldn't crash the whole app)
- The compositing/review section (canvas errors shouldn't crash the whole app)

## 3. Remove `as any` Casts — Improve Type Safety

### Current problems:
```typescript
// FrameSelector.tsx — session is cast as any
setSession({ id: data.sessionId } as any);
```

### Fix:
- Define a `PartialSession` type or make `Session` fields optional where appropriate:
```typescript
// In booth-store.ts or supabase.ts
type SessionInit = Pick<Session, 'id'> & Partial<Omit<Session, 'id'>>;
```
- Update `setSession` to accept `Session | SessionInit | null`
- Audit all other `as any` usages across the codebase and replace with proper types

### Files to audit for `as any`:
- `src/components/booth/FrameSelector.tsx`
- `src/components/booth/ReviewScreen.tsx`
- `src/components/booth/PaymentScreen.tsx`
- `src/app/page.tsx`
