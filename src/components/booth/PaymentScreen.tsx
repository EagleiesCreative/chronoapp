'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { QrCode, Clock, CheckCircle, XCircle, Loader2, ArrowLeft } from 'lucide-react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { formatIDR } from '@/lib/xendit';
import { getApiUrl } from '@/lib/api';

export function PaymentScreen() {
    const {
        selectedFrame,
        session,
        setSession,
        setPayment,
        invoiceUrl,
        setInvoiceUrl,
        setStep,
        setIsLoading,
        setError,
        appliedVoucher,
    } = useBoothStore();

    const { booth } = useTenantStore();
    const [qrCodeImage, setQrCodeImage] = useState<string | null>(null);
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid' | 'expired' | 'failed'>('pending');
    const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
    const [isCreating, setIsCreating] = useState(false);

    // Price info from store or booth
    const originalPrice = appliedVoucher?.original_price ?? booth?.price ?? 0;
    const discountAmount = appliedVoucher?.discount_value ?? 0;
    const finalPrice = appliedVoucher?.final_price ?? booth?.price ?? 0;

    // Create payment on mount
    useEffect(() => {
        async function createPayment() {
            if (!selectedFrame || isCreating) return;

            setIsCreating(true);
            setIsLoading(true);

            try {
                const response = await fetch(getApiUrl('/api/payment/create'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        frameId: selectedFrame.id,
                        voucherCode: appliedVoucher?.code || undefined,
                    }),
                });

                const data = await response.json();

                if (data.success) {
                    setSession({ id: data.sessionId } as any);

                    // Handle free session (100% discount)
                    if (data.isFree) {
                        setPaymentStatus('paid');
                        setTimeout(() => {
                            setStep('capturing');
                        }, 1500);
                        return;
                    }

                    setPayment({ id: data.paymentId } as any);
                    setInvoiceUrl(data.invoiceUrl);

                    const qrDataUrl = await QRCode.toDataURL(data.invoiceUrl, {
                        width: 320,
                        margin: 2,
                        color: {
                            dark: '#1A1A1A',
                            light: '#FFFFFF',
                        },
                    });
                    setQrCodeImage(qrDataUrl);
                } else {
                    setError(data.error || 'Failed to create payment');
                }
            } catch (err) {
                setError('Failed to create payment');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        }

        createPayment();
    }, [selectedFrame]); // eslint-disable-line react-hooks/exhaustive-deps

    // Poll for payment status
    useEffect(() => {
        if (!session?.id || paymentStatus !== 'pending') return;

        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(getApiUrl(`/api/payment/status?sessionId=${session.id}`));
                const data = await response.json();

                if (data.success) {
                    setPaymentStatus(data.status);

                    if (data.status === 'paid') {
                        setStep('capturing');
                    }
                }
            } catch (err) {
                console.error('Error checking payment status:', err);
            }
        }, 3000);

        return () => clearInterval(pollInterval);
    }, [session?.id, paymentStatus, setStep]);

    // Countdown timer
    useEffect(() => {
        if (paymentStatus !== 'pending' || timeLeft <= 0) return;

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    setPaymentStatus('expired');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [paymentStatus, timeLeft]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleBack = () => {
        setStep('select-frame');
        setSession(null);
        setPayment(null);
        setInvoiceUrl(null);
    };

    const handleRetry = () => {
        setPaymentStatus('pending');
        setTimeLeft(300);
        setSession(null);
        setPayment(null);
        setInvoiceUrl(null);
        setQrCodeImage(null);
    };

    const handleSimulatePaid = async () => {
        if (!session?.id) return;

        try {
            const response = await fetch(getApiUrl('/api/payment/simulate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: session.id }),
            });

            const data = await response.json();

            if (data.success) {
                setPaymentStatus('paid');
                setTimeout(() => {
                    setStep('capturing');
                }, 1500);
            } else {
                console.error('Failed to simulate payment:', data.error);
            }
        } catch (err) {
            console.error('Simulate payment error:', err);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-screen flex flex-col items-center justify-center p-8 bg-white kiosk"
        >
            {/* Header */}
            <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center mb-10"
            >
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full border border-border mb-5">
                    <QrCode className="w-6 h-6 text-primary" strokeWidth={1.5} />
                </div>
                <h2 className="text-3xl font-light mb-2">Scan to Pay</h2>
                <p className="text-muted-foreground font-light">
                    Use your payment app to scan the QR code
                </p>
            </motion.div>

            {/* Main content */}
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
            >
                <div className="elegant-card p-8">
                    {/* QR Code */}
                    <div className="relative mb-6">
                        {qrCodeImage && paymentStatus === 'pending' ? (
                            <motion.div
                                initial={{ scale: 0.9 }}
                                animate={{ scale: 1 }}
                                className="p-4"
                            >
                                <img
                                    src={qrCodeImage}
                                    alt="Payment QR Code"
                                    className="w-72 h-72"
                                />
                            </motion.div>
                        ) : paymentStatus === 'paid' ? (
                            <div className="w-72 h-72 flex items-center justify-center">
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: 'spring', stiffness: 200 }}
                                >
                                    <CheckCircle className="w-24 h-24 text-primary" strokeWidth={1} />
                                </motion.div>
                            </div>
                        ) : paymentStatus === 'expired' || paymentStatus === 'failed' ? (
                            <div className="w-72 h-72 flex items-center justify-center">
                                <XCircle className="w-24 h-24 text-destructive" strokeWidth={1} />
                            </div>
                        ) : (
                            <div className="w-72 h-72 flex items-center justify-center">
                                <Loader2 className="w-12 h-12 animate-spin text-muted-foreground" />
                            </div>
                        )}
                    </div>

                    {/* Payment info */}
                    <div className="text-center">
                        {/* Show discount if applied */}
                        {discountAmount > 0 && (
                            <div className="mb-2">
                                <p className="text-sm text-muted-foreground line-through">
                                    {formatIDR(originalPrice)}
                                </p>
                                <p className="text-xs text-green-600">
                                    -{formatIDR(discountAmount)} discount
                                </p>
                            </div>
                        )}

                        <p className="text-2xl font-medium text-foreground mb-1">
                            {formatIDR(finalPrice)}
                        </p>

                        <p className="text-muted-foreground font-light mb-4">
                            {selectedFrame?.name || 'Loading...'}
                        </p>

                        {/* Timer */}
                        {paymentStatus === 'pending' && (
                            <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                <Clock className="w-4 h-4" strokeWidth={1.5} />
                                <span className="text-sm font-mono">
                                    Expires in {formatTime(timeLeft)}
                                </span>
                            </div>
                        )}

                        {/* Status messages */}
                        {paymentStatus === 'paid' && (
                            <motion.p
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-lg text-primary font-medium"
                            >
                                Payment successful
                            </motion.p>
                        )}

                        {paymentStatus === 'expired' && (
                            <p className="text-lg text-destructive font-medium">
                                Payment expired
                            </p>
                        )}

                        {paymentStatus === 'failed' && (
                            <p className="text-lg text-destructive font-medium">
                                Payment failed
                            </p>
                        )}
                    </div>
                </div>
            </motion.div>

            {/* Action buttons */}
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="flex gap-4 mt-8"
            >
                <Button
                    variant="ghost"
                    size="lg"
                    onClick={handleBack}
                    className="px-8 py-6 text-base font-normal rounded-full border border-border touch-target"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    Back
                </Button>

                {/* Test button */}
                {paymentStatus === 'pending' && session?.id && (
                    <Button
                        variant="secondary"
                        size="lg"
                        onClick={handleSimulatePaid}
                        className="px-8 py-6 text-base font-normal rounded-full touch-target"
                    >
                        <CheckCircle className="w-4 h-4 mr-2" strokeWidth={1.5} />
                        Test Payment
                    </Button>
                )}

                {(paymentStatus === 'expired' || paymentStatus === 'failed') && (
                    <Button
                        size="lg"
                        onClick={handleRetry}
                        className="px-8 py-6 text-base font-medium rounded-full elegant-shadow touch-target"
                    >
                        Try Again
                    </Button>
                )}
            </motion.div>

            {/* Supported payment methods */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="mt-10 text-center"
            >
                <p className="text-xs text-muted-foreground/60 mb-2 font-light tracking-wide">
                    Supported payments
                </p>
                <div className="flex items-center justify-center gap-4 text-muted-foreground/50 text-xs font-light">
                    <span>QRIS</span>
                    <span>·</span>
                    <span>GoPay</span>
                    <span>·</span>
                    <span>OVO</span>
                    <span>·</span>
                    <span>DANA</span>
                </div>
            </motion.div>
        </motion.div>
    );
}
