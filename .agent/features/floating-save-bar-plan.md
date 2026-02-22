# Feature: Floating Save Bar for Settings

> **Author**: Senior Software Engineer  
> **Date**: 2026-02-22  
> **Status**: Implementation Plan  

## 1. Overview

The user requested replacing the static "Save Background Settings" button with a floating dialog/bar at the bottom of the app that appears whenever there are unsaved changes. This pattern will apply to any settings that require explicit saves.

Currently, `BackgroundSettings.tsx` is the primary component that holds local unsaved state before making an API call to save to Supabase (`PATCH /api/booth/settings`). Other settings like Camera/Printer immediately auto-save to local storage, but can be adapted to this pattern if they require API saves in the future.

### Current Flow
1. User changes color, image, or toggle in `BackgroundSettings`
2. User scrolls to the bottom of the `BackgroundSettings` card
3. User clicks "Save Background Settings"

### New Flow
1. User changes a setting.
2. The UI detects `localState !== savedState`
3. A global floating bar animates in at the bottom of the screen: "You have unsaved changes. [Discard] [Apply Settings]"
4. Clicking Apply saves the settings and dismisses the bar. Clicking Discard reverts the local state.

---

## 2. Architecture & Components

### 2.1 Reusable `FloatingSaveBar` Component (New)
Create `src/components/ui/floating-save-bar.tsx`.

```tsx
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';

interface FloatingSaveBarProps {
    isVisible: boolean;
    onSave: () => void;
    onDiscard: () => void;
    isSaving: boolean;
}

export function FloatingSaveBar({ isVisible, onSave, onDiscard, isSaving }: FloatingSaveBarProps) {
    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-2xl bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl p-4 flex items-center justify-between z-[200]"
                >
                    <div className="flex items-center gap-3 text-white">
                        <div className="bg-amber-500/20 p-2 rounded-full">
                            <AlertCircle className="w-5 h-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="font-medium text-sm">Unsaved changes</p>
                            <p className="text-xs text-slate-400">Apply your settings to see them in the kiosk</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button 
                            variant="ghost" 
                            onClick={onDiscard} 
                            disabled={isSaving}
                            className="text-slate-300 hover:text-white hover:bg-slate-800"
                        >
                            Discard
                        </Button>
                        <Button 
                            onClick={onSave} 
                            disabled={isSaving}
                            className="bg-white text-black hover:bg-slate-200"
                        >
                            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Apply Settings
                        </Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
```

### 2.2 Updating `BackgroundSettings.tsx`

1. **Calculate `isDirty` State**:
   Compare the local React state against what is currently in `useTenantStore`.
   ```tsx
   const isDirty = 
       selectedColor !== (booth?.background_color || '#ffffff') ||
       backgroundImage !== (booth?.background_image || '') ||
       paymentBypass !== (booth?.payment_bypass || false);
   ```

2. **Add `handleDiscard` function**:
   ```tsx
   const handleDiscard = () => {
       setSelectedColor(booth?.background_color || '#ffffff');
       setBackgroundImage(booth?.background_image || '');
       setPaymentBypass(booth?.payment_bypass || false);
   };
   ```

3. **Remove inline Save button**: Remove the `Button` at the bottom of the `CardContent`.

4. **Render `FloatingSaveBar`**: Add it to the return payload. Since it uses `fixed`, it can be rendered inside the component but visually attach to the screen bottom.
   ```tsx
   return (
       <>
           <Card>...</Card>
           <FloatingSaveBar 
               isVisible={isDirty} 
               onSave={handleSave} 
               onDiscard={handleDiscard} 
               isSaving={isSaving} 
           />
       </>
   );
   ```

---

## 3. Verification Plan

1. **Test Triggering**: Open the Admin Panel, navigate to Idle Screen Background. Change the Payment Bypass toggle.
2. **Confirm Visibility**: The dark floating save bar should instantly slide up from the bottom of the screen.
3. **Test Discard**: Click 'Discard'. The toggle should revert to its original state, and the floating bar should slide out.
4. **Test Apply**: Change a color. Click 'Apply Settings'. The loader should spin, a success toast should appear, the `tenant-store` should update, and the floating bar should disappear since state now matches.
5. **No Regression**: Ensure camera and printer selectors still function normally (they auto-save and shouldn't trigger this bar, unless we plan to add it to them later).
