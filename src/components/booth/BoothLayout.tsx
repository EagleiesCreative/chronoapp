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

    return (
        <BoothErrorBoundary fallbackMessage="The photo booth encountered an unexpected error. Don't worry, we'll get you back on track.">
            <div style={brandingStyle}>
                <CameraProvider>
                    <AnimatePresence mode="wait">
                        {step === 'idle' && <IdleScreen key="idle" />}
                        {step === 'voucher' && <VoucherScreen key="voucher" />}
                        {step === 'select-frame' && <FrameSelector key="select-frame" />}
                        {step === 'payment' && <PaymentScreen key="payment" />}
                        {step === 'countdown' && <CountdownScreen key="countdown" />}
                        {step === 'capturing' && <CaptureScreen key="capturing" />}
                        {step === 'filter' && <FilterScreen key="filter" />}
                        {step === 'review' && <ReviewScreen key="review" />}
                    </AnimatePresence>
                </CameraProvider>
            </div>
        </BoothErrorBoundary>
    );
}
