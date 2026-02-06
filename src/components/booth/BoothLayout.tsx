'use client';

import { AnimatePresence } from 'framer-motion';
import { useBoothStore } from '@/store/booth-store';
import { IdleScreen } from './IdleScreen';
import { VoucherScreen } from './VoucherScreen';
import { FrameSelector } from './FrameSelector';
import { PaymentScreen } from './PaymentScreen';
import { CountdownScreen } from './CountdownScreen';
import { CaptureScreen } from './CaptureScreen';
import { ReviewScreen } from './ReviewScreen';

import { CameraProvider } from './CameraProvider';

export function BoothLayout() {
    const { step } = useBoothStore();

    return (
        <CameraProvider>
            <AnimatePresence mode="wait">
                {step === 'idle' && <IdleScreen key="idle" />}
                {step === 'voucher' && <VoucherScreen key="voucher" />}
                {step === 'select-frame' && <FrameSelector key="select-frame" />}
                {step === 'payment' && <PaymentScreen key="payment" />}
                {step === 'countdown' && <CountdownScreen key="countdown" />}
                {step === 'capturing' && <CaptureScreen key="capturing" />}
                {step === 'review' && <ReviewScreen key="review" />}
            </AnimatePresence>
        </CameraProvider>
    );
}
