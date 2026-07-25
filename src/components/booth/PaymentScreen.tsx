'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, CheckCircle, XCircle, Loader2, ArrowLeft } from 'lucide-react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { formatIDR } from '@/lib/xendit';
import { apiFetch } from '@/lib/api';

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
        printQuantity,
        setPrintQuantity,
    } = useBoothStore();

    const { booth } = useTenantStore();
    const activeSession = useSessionProfileStore((s) => s.activeSession);
    // The active session's price is the authoritative amount; booth.price is only
    // a fallback. Using it here stops the screen showing the stale booth default
    // (e.g. 25000) before the QR/server response arrives.
    const displayBasePrice = activeSession?.price ?? booth?.price ?? 0;
    const [qrCodeImage, setQrCodeImage] = useState<string | null>(null);
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid' | 'expired' | 'failed'>('pending');
    const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
    const [isCreating, setIsCreating] = useState(false);

    const [printCopies, setPrintCopies] = useState<number | null>(printQuantity);
    const [originalPrice, setOriginalPrice] = useState<number>(appliedVoucher?.original_price ?? displayBasePrice);
    const [discountAmount, setDiscountAmount] = useState<number>(appliedVoucher?.discount_value ?? 0);
    const [finalPrice, setFinalPrice] = useState<number>(appliedVoucher?.final_price ?? displayBasePrice);

    useEffect(() => {
        async function createPayment() {
            if (!selectedFrame || isCreating) return;

            setIsCreating(true);
            setIsLoading(true);

            try {
                const response = await apiFetch('/api/payment/create', {
                    method: 'POST',
                    body: JSON.stringify({
                        frameId: selectedFrame.id,
                        voucherCode: appliedVoucher?.code || undefined,
                        printCopies: printQuantity ?? undefined,
                    }),
                });

                const data = await response.json();

                if (data.success) {
                    // Update state with server-authoritative prices directly from DB
                    if (data.originalAmount !== undefined) setOriginalPrice(data.originalAmount);
                    if (data.discountAmount !== undefined) setDiscountAmount(data.discountAmount);
                    if (data.amount !== undefined) setFinalPrice(data.amount);
                    if (data.printCopies !== undefined) {
                        // Server-clamped copy count is what the guest is paying for.
                        setPrintCopies(data.printCopies);
                        setPrintQuantity(data.printCopies);
                    }

                    setSession({ id: data.sessionId });

                    if (data.isFree) {
                        setPaymentStatus('paid');
                        setTimeout(() => setStep('capturing'), 1500);
                        return;
                    }

                    setPayment({ id: data.paymentId });
                    setInvoiceUrl(data.invoiceUrl);

                    const qrDataUrl = await QRCode.toDataURL(data.invoiceUrl, {
                        width: 320,
                        margin: 2,
                        color: { dark: '#1A1A1A', light: '#FFFFFF' },
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
    }, [selectedFrame]);

    useEffect(() => {
        if (!session?.id || paymentStatus !== 'pending') return;

        const pollInterval = setInterval(async () => {
            try {
                const response = await apiFetch(`/api/payment/status?sessionId=${session.id}`);
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

    // Return to start screen when expired
    useEffect(() => {
        if (paymentStatus === 'expired') {
            const timeout = setTimeout(() => {
                setStep('idle');
                setSession(null);
                setPayment(null);
                setInvoiceUrl(null);
            }, 3000); // Wait 3 seconds then return to start page
            return () => clearTimeout(timeout);
        }
    }, [paymentStatus, setStep, setSession, setPayment, setInvoiceUrl]);

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
        setIsCreating(false);
    };

    const progress = (timeLeft / 300) * 100;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full bg-white font-sans text-slate-900 flex flex-col md:flex-row border-t-4 border-yellow-400 overflow-hidden"
        >
            {/* Left Column: Instructions */}
            <div className="flex-1 p-8 md:p-12 border-r border-slate-100 flex flex-col justify-between">
                <div>
                    <div className="flex items-center justify-between mb-12">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-black rounded-full"></div>
                            <span className="font-black tracking-widest text-lg">PHOTOBOOTH</span>
                        </div>
                    </div>

                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-full mb-8">
                        {paymentStatus === 'pending' ? (
                            <>
                                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                                <span className="text-yellow-700 font-medium text-sm">Waiting for payment</span>
                            </>
                        ) : paymentStatus === 'paid' ? (
                            <>
                                <CheckCircle className="w-4 h-4 text-green-500" />
                                <span className="text-green-700 font-medium text-sm">Payment Successful</span>
                            </>
                        ) : (
                            <>
                                <XCircle className="w-4 h-4 text-red-500" />
                                <span className="text-red-700 font-medium text-sm">Payment Failed/Expired</span>
                            </>
                        )}
                    </div>

                    <h1 className="text-6xl font-extrabold tracking-tight mb-4 leading-none">
                        Scan &<br />pay now
                    </h1>
                    <p className="text-slate-400 text-lg mb-12">Complete within the time limit</p>

                    <div className="space-y-4">
                        {[
                            "Open your e-wallet or banking app",
                            "Tap scan QR & point at screen",
                            "Confirm & done — enjoy your shoot"
                        ].map((text, i) => (
                            <div key={i} className="flex items-center gap-6 p-6 bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-md transition-shadow">
                                <div className="w-10 h-10 rounded-full bg-yellow-50 text-yellow-600 flex items-center justify-center font-bold text-lg">
                                    {i + 1}
                                </div>
                                <p className="font-semibold text-slate-700 leading-snug">{text}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-12">
                    <Button
                        variant="ghost"
                        size="lg"
                        onClick={handleBack}
                        className="px-6 py-6 text-base font-normal rounded-full border border-slate-200 w-fit hover:bg-slate-50 mb-6"
                    >
                        <ArrowLeft className="w-5 h-5 mr-2" />
                        Go Back
                    </Button>
                    <div className="flex items-center gap-2 text-slate-400">
                        <Shield size={18} />
                        <span className="text-sm font-medium">Secured by Bank Indonesia · QRIS Standard</span>
                    </div>
                </div>
            </div>

            {/* Middle Column: QR Code */}
            <div className="flex-[1.2] bg-white p-8 md:p-12 flex flex-col items-center justify-center relative">
                <div className="w-full max-w-md p-10 bg-white border border-slate-100 rounded-[3rem] shadow-xl flex flex-col items-center relative overflow-hidden">
                    <span className="text-xs font-black tracking-[0.3em] text-slate-300 mb-8">QRIS</span>

                    <div className="relative p-6 border-2 border-slate-50 rounded-2xl mb-10 bg-white">
                        <div className="absolute -top-1 -left-1 w-10 h-10 border-t-4 border-l-4 border-yellow-400 rounded-tl-2xl z-10"></div>
                        <div className="absolute -top-1 -right-1 w-10 h-10 border-t-4 border-r-4 border-yellow-400 rounded-tr-2xl z-10"></div>
                        <div className="absolute -bottom-1 -left-1 w-10 h-10 border-b-4 border-l-4 border-yellow-400 rounded-bl-2xl z-10"></div>
                        <div className="absolute -bottom-1 -right-1 w-10 h-10 border-b-4 border-r-4 border-yellow-400 rounded-br-2xl z-10"></div>

                        <div className="w-56 h-56 relative flex items-center justify-center p-2 bg-white">
                            <AnimatePresence mode="wait">
                                {paymentStatus === 'pending' && qrCodeImage ? (
                                    <motion.img
                                        key="qr"
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        src={qrCodeImage}
                                        alt="Payment QR Code"
                                        className="w-full h-full object-contain"
                                    />
                                ) : paymentStatus === 'pending' && !qrCodeImage ? (
                                    <motion.div
                                        key="loader"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="w-full h-full flex items-center justify-center"
                                    >
                                        <Loader2 className="w-12 h-12 animate-spin text-slate-300" />
                                    </motion.div>
                                ) : paymentStatus === 'paid' ? (
                                    <motion.div
                                        key="paid"
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 200 }}
                                        className="flex items-center justify-center w-full h-full"
                                    >
                                        <CheckCircle className="w-24 h-24 text-green-500" />
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="failed"
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        className="flex flex-col items-center justify-center w-full h-full text-red-500"
                                    >
                                        <XCircle className="w-24 h-24 mb-4" />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {paymentStatus === 'pending' && qrCodeImage && (
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-1.5 bg-white rounded-lg shadow-md border border-slate-100 z-20">
                                    <div
                                        className="w-8 h-8 bg-yellow-400 flex items-center justify-center rounded"
                                        style={{ clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' }}
                                    ></div>
                                </div>
                            )}
                        </div>
                    </div>

                    {(paymentStatus === 'failed' || paymentStatus === 'expired') ? (
                        <Button
                            onClick={handleRetry}
                            className="bg-red-50 text-red-600 hover:bg-red-100 px-8 py-6 rounded-full font-bold text-lg"
                        >
                            Try Again
                        </Button>
                    ) : (
                        <div className="flex flex-wrap justify-center gap-3">
                            {["GoPay", "OVO", "Dana", "BCA", "BRI"].map(brand => (
                                <span key={brand} className="px-4 py-2 bg-slate-50 rounded-full text-xs font-bold text-slate-500 border border-slate-100">
                                    {brand}
                                </span>
                            ))}
                            <span className="px-4 py-2 bg-slate-50 rounded-full text-xs font-bold text-slate-400 border border-slate-100">+more</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Column: Order Summary */}
            <div className="flex-1 bg-slate-50 p-8 md:p-12 flex flex-col justify-between">
                <div>
                    <span className="text-xs font-black tracking-[0.3em] text-slate-400 block mb-12">ORDER SUMMARY</span>

                    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm mb-6 border border-slate-100">
                        <span className="text-slate-400 font-semibold block mb-1">Total payment</span>
                        <span className="text-sm font-bold text-slate-400">IDR</span>
                        <div className="text-5xl font-black text-slate-900 mb-6">{formatIDR(finalPrice).replace('Rp', '').trim()}</div>
                        {discountAmount > 0 && (
                            <div className="text-sm text-green-600 font-semibold mb-4 border border-green-100 bg-green-50 px-3 py-1 rounded inline-block">
                                -{formatIDR(discountAmount)} Discount
                            </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <div className="inline-block px-4 py-2 bg-green-50 text-green-700 text-xs font-bold rounded-full border border-green-100">
                                {selectedFrame?.name || 'Photobooth Session'}
                            </div>
                            {printCopies !== null && printCopies > 0 && (
                                <div className="inline-block px-4 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-full border border-slate-200">
                                    {printCopies} {printCopies === 1 ? 'print' : 'prints'}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex items-center justify-between">
                        <div>
                            <span className="text-slate-400 font-semibold block mb-2">Time remaining</span>
                            <div className="text-5xl font-black text-slate-900 tracking-tight">
                                {formatTime(timeLeft)}
                            </div>
                        </div>
                        <div className="relative w-16 h-16">
                            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                <circle
                                    cx="18" cy="18" r="16"
                                    fill="none"
                                    className="stroke-slate-100"
                                    strokeWidth="3"
                                />
                                <circle
                                    cx="18" cy="18" r="16"
                                    fill="none"
                                    className="stroke-yellow-500 transition-all duration-1000"
                                    strokeWidth="3"
                                    strokeDasharray={`${progress}, 100`}
                                    strokeLinecap="round"
                                />
                            </svg>
                        </div>
                    </div>
                </div>

                <div className="mt-12 flex items-center justify-end gap-2 text-slate-300">
                    <Shield size={18} />
                    <span className="text-sm font-medium">QRIS · Bank Indonesia</span>
                </div>
            </div>
        </motion.div>
    );
}

