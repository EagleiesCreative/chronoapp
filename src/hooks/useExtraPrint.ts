import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { apiFetch } from '@/lib/api';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { DEFAULT_EXTRA_PRINT_PRICE } from '@/lib/supabase';

/** How long a guest has to pay for an extra print before the QR is dropped. */
const EXTRA_PRINT_WINDOW_SECONDS = 180;
const POLL_INTERVAL_MS = 3000;

export type ExtraPrintStatus =
    | 'idle'        // Overlay closed
    | 'creating'    // Requesting the QRIS payment
    | 'awaiting'    // QR on screen, polling for payment
    | 'paid'        // Settled — caller should print
    | 'expired'
    | 'failed'
    | 'error';      // Could not create the payment at all

/**
 * Sells one additional print of the current session.
 *
 * Each purchase is its own QRIS payment (payment_type = 'extra_print'), so a
 * guest can buy several copies in a row and each is tracked independently.
 */
export function useExtraPrint() {
    const { session } = useBoothStore();
    const { booth } = useTenantStore();

    const sessionId = session?.id;
    const price = booth?.extra_print_price ?? DEFAULT_EXTRA_PRINT_PRICE;
    const isEnabled = (booth?.extra_print_enabled ?? true) && !!sessionId;

    const [status, setStatus] = useState<ExtraPrintStatus>('idle');
    const [qrImage, setQrImage] = useState<string | null>(null);
    const [paymentId, setPaymentId] = useState<string | null>(null);
    const [amount, setAmount] = useState<number>(price);
    const [secondsLeft, setSecondsLeft] = useState(EXTRA_PRINT_WINDOW_SECONDS);
    const [error, setError] = useState<string | null>(null);

    // Guards against a stale in-flight request writing over a newer attempt.
    const attemptRef = useRef(0);

    const isOverlayOpen = status !== 'idle';

    const reset = useCallback(() => {
        attemptRef.current += 1;
        setStatus('idle');
        setQrImage(null);
        setPaymentId(null);
        setError(null);
        setSecondsLeft(EXTRA_PRINT_WINDOW_SECONDS);
    }, []);

    const start = useCallback(async () => {
        if (!sessionId) {
            setStatus('error');
            setError('No active session');
            return;
        }

        const attempt = ++attemptRef.current;
        setStatus('creating');
        setError(null);
        setQrImage(null);
        setPaymentId(null);
        setSecondsLeft(EXTRA_PRINT_WINDOW_SECONDS);

        try {
            const response = await apiFetch('/api/payment/extra-print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ sessionId }),
            });

            const data = await response.json();
            if (attempt !== attemptRef.current) return; // Superseded

            if (!response.ok || !data.success) {
                setStatus('error');
                setError(data.error || 'Could not start the payment');
                return;
            }

            setAmount(data.amount ?? price);

            // Payment bypass booths hand out extra prints for free.
            if (data.isFree) {
                setStatus('paid');
                return;
            }

            const qr = await QRCode.toDataURL(data.qrString, {
                width: 320,
                margin: 2,
                color: { dark: '#1A1A1A', light: '#FFFFFF' },
            });

            if (attempt !== attemptRef.current) return;

            setPaymentId(data.paymentId);
            setQrImage(qr);
            setStatus('awaiting');
        } catch (err) {
            if (attempt !== attemptRef.current) return;
            console.error('[useExtraPrint] Failed to create payment:', err);
            setStatus('error');
            setError(err instanceof Error ? err.message : 'Could not start the payment');
        }
    }, [sessionId, price]);

    // Poll for settlement.
    useEffect(() => {
        if (status !== 'awaiting' || !paymentId) return;

        const attempt = attemptRef.current;

        const poll = setInterval(async () => {
            try {
                const response = await apiFetch(`/api/payment/extra-print?paymentId=${paymentId}`);
                const data = await response.json();

                if (attempt !== attemptRef.current) return;
                if (!data.success) return;

                if (data.status === 'paid') setStatus('paid');
                else if (data.status === 'expired') setStatus('expired');
                else if (data.status === 'failed') setStatus('failed');
            } catch (err) {
                // Transient network blips are expected on booth wifi — keep polling.
                console.warn('[useExtraPrint] Status poll failed:', err);
            }
        }, POLL_INTERVAL_MS);

        return () => clearInterval(poll);
    }, [status, paymentId]);

    // Local expiry countdown.
    useEffect(() => {
        if (status !== 'awaiting') return;

        const timer = setInterval(() => {
            setSecondsLeft((prev) => {
                if (prev <= 1) {
                    setStatus('expired');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [status]);

    return {
        isEnabled,
        price,
        amount,
        status,
        isOverlayOpen,
        qrImage,
        secondsLeft,
        error,
        start,
        reset,
    };
}
