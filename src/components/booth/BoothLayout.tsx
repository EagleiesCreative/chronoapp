'use client';

import { AnimatePresence } from 'framer-motion';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { IdleScreen } from './IdleScreen';
import { VoucherScreen } from './VoucherScreen';
import { FrameSelector } from './FrameSelector';
import { PaymentScreen } from './PaymentScreen';
import { CountdownScreen } from './CountdownScreen';
import { CaptureScreen } from './CaptureScreen';
import { FilterScreen } from './FilterScreen';
import { FinalReviewScreen } from './FinalReviewScreen';
import { ReviewScreen } from './ReviewScreen';

import { CameraProvider } from './CameraProvider';
import { BoothErrorBoundary } from './BoothErrorBoundary';

function hexToHSL(hex: string): string {
    // Convert hex to HSL for CSS custom properties
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return '';

    let r = parseInt(result[1], 16) / 255;
    let g = parseInt(result[2], 16) / 255;
    let b = parseInt(result[3], 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const STEPS = [
    { label: 'Frame', activeSteps: ['select-frame'] },
    { label: 'Payment', activeSteps: ['voucher', 'payment'] },
    { label: 'Capture', activeSteps: ['countdown', 'capturing'] },
    { label: 'Filter', activeSteps: ['filter'] },
    { label: 'Review', activeSteps: ['final-review', 'review'] }
];

export function BoothLayout() {
    const { step } = useBoothStore();
    const { booth } = useTenantStore();

    // Dynamic branding CSS custom properties
    const brandingStyle: React.CSSProperties = {};
    if (booth?.brand_primary_color) {
        const hsl = hexToHSL(booth.brand_primary_color);
        if (hsl) {
            (brandingStyle as Record<string, string>)['--primary'] = hsl;
            (brandingStyle as Record<string, string>)['--ring'] = hsl;
        }
    }
    if (booth?.brand_accent_color) {
        const hsl = hexToHSL(booth.brand_accent_color);
        if (hsl) {
            (brandingStyle as Record<string, string>)['--accent'] = hsl;
        }
    }

    const isNewspaper = booth?.booth_type === 'A3_NEWSPAPER';

    const currentStepIndex = STEPS.findIndex((s) => s.activeSteps.includes(step));
    const showProgress = step !== 'idle' && currentStepIndex !== -1;

    return (
        <BoothErrorBoundary fallbackMessage="The photo booth encountered an unexpected error. Don't worry, we'll get you back on track.">
            <div 
                style={brandingStyle} 
                className={isNewspaper ? 'newspaper-layout w-full h-screen flex flex-col overflow-hidden select-none' : 'w-full h-screen flex flex-col overflow-hidden select-none'}
            >
                {showProgress && (
                    <div className="w-full bg-white/80 backdrop-blur-md border-b border-border/50 py-2.5 px-6 flex justify-center items-center select-none z-40">
                        <div className="flex items-center gap-1 max-w-lg w-full justify-between">
                            {STEPS.map((s, idx) => {
                                const isCompleted = idx < currentStepIndex;
                                const isActive = idx === currentStepIndex;
                                return (
                                    <div key={idx} className="flex items-center flex-1 last:flex-none">
                                        <div className="flex items-center gap-1.5">
                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all duration-300 ${
                                                isActive 
                                                    ? 'bg-primary text-primary-foreground font-bold scale-105 shadow-sm' 
                                                    : isCompleted 
                                                        ? 'bg-primary/20 text-primary font-medium' 
                                                        : 'bg-muted text-muted-foreground'
                                            }`}>
                                                {isCompleted ? '✓' : idx + 1}
                                            </div>
                                            <span className={`text-[10px] font-medium hidden sm:inline transition-colors duration-300 ${
                                                isActive ? 'text-foreground font-bold' : 'text-muted-foreground'
                                            }`}>
                                                {s.label}
                                            </span>
                                        </div>
                                        {idx < STEPS.length - 1 && (
                                            <div className="flex-1 h-0.5 mx-1.5 bg-muted relative overflow-hidden">
                                                <div 
                                                    className="absolute inset-y-0 left-0 right-0 bg-primary origin-left transition-transform duration-500 ease-out"
                                                    style={{ transform: `scaleX(${isCompleted ? 1 : 0})` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="flex-1 w-full relative overflow-hidden">
                    <CameraProvider>
                        <AnimatePresence mode="wait">
                            {step === 'idle' && <IdleScreen key="idle" />}
                            {step === 'voucher' && <VoucherScreen key="voucher" />}
                            {step === 'select-frame' && <FrameSelector key="select-frame" />}
                            {step === 'payment' && <PaymentScreen key="payment" />}
                            {step === 'countdown' && <CountdownScreen key="countdown" />}
                            {step === 'capturing' && <CaptureScreen key="capturing" />}
                            {step === 'filter' && <FilterScreen key="filter" />}
                            {step === 'final-review' && <FinalReviewScreen key="final-review" />}
                            {step === 'review' && <ReviewScreen key="review" />}
                        </AnimatePresence>
                    </CameraProvider>
                </div>
            </div>
        </BoothErrorBoundary>
    );
}
