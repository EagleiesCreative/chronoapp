'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Loader2, Printer } from 'lucide-react';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';

import { useCompositing } from '@/hooks/useCompositing';
import { useUploadSession } from '@/hooks/useUploadSession';
import { usePrintHandler } from '@/hooks/usePrintHandler';

import { ReviewActions } from './ReviewActions';
import { ReviewQRCode } from './ReviewQRCode';
import { BoothErrorBoundary } from './BoothErrorBoundary';

export function ReviewScreen() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const { setStep, resetSession } = useBoothStore();
    const { booth } = useTenantStore();
    const timeoutSeconds = booth?.review_timeout_seconds ?? 60;

    const [autoResetCountdown, setAutoResetCountdown] = useState(timeoutSeconds);

    const { compositeImage, isCompositing } = useCompositing(canvasRef);
    const {
        downloadQR, isUploading, uploadStatus,
        uploadError, uploadAndGenerateQR
    } = useUploadSession();
    const { isPrinting, handlePrint, printCopiesCount } = usePrintHandler(compositeImage);

    // Trigger upload when compositing completes
    const hasUploadedRef = useRef(false);
    useEffect(() => {
        if (compositeImage && !hasUploadedRef.current) {
            hasUploadedRef.current = true;
            uploadAndGenerateQR(compositeImage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compositeImage]);

    // Auto-reset timer
    useEffect(() => {
        if (isCompositing || isPrinting) return;
        if (autoResetCountdown <= 0) return;

        const timer = setInterval(() => {
            setAutoResetCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(timer);
    }, [isCompositing, isPrinting, autoResetCountdown]);

    // Navigate to idle when countdown reaches 0
    useEffect(() => {
        if (autoResetCountdown === 0 && !isCompositing && !isPrinting) {
            resetSession();
            setStep('idle');
        }
    }, [autoResetCountdown, isCompositing, isPrinting, resetSession, setStep]);

    const resetCountdown = () => setAutoResetCountdown(timeoutSeconds);

    const handleNewSession = () => {
        resetSession();
        setStep('idle');
    };

    const handlePrintWithReset = () => {
        handlePrint(resetCountdown);
    };

    return (
        <BoothErrorBoundary fallbackMessage="There was an issue processing your photo. Please restart your session.">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-screen flex flex-col items-center justify-center p-6 bg-white kiosk overflow-hidden"
            >
                {/* Hidden canvas */}
                <canvas ref={canvasRef} className="hidden" />

                {/* Header */}
                <motion.div
                    initial={{ y: -20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-center shrink-0 mb-4"
                >
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-border mb-2">
                        <CheckCircle className="w-5 h-5 text-primary" strokeWidth={1.5} />
                    </div>
                    <h2 className="text-xl font-light mb-1">Your Photo is Ready</h2>
                    <p className="text-muted-foreground font-light text-sm">
                        Print or download your photo
                    </p>
                    {booth?.brand_logo_url && (
                        <img src={booth.brand_logo_url} alt="Logo" className="h-8 w-auto mx-auto mt-2 object-contain opacity-80" />
                    )}
                    {booth?.event_mode && booth?.event_message && (
                        <p className="text-xs text-primary font-medium mt-1">{booth.event_message}</p>
                    )}
                </motion.div>

                {/* Main content */}
                <div className="flex-1 flex gap-8 items-center w-full max-w-4xl justify-center py-4">
                    {/* Composite preview */}
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="flex items-center justify-center"
                    >
                        <div className="elegant-card overflow-hidden">
                            {isCompositing ? (
                                <div className="w-48 aspect-[3/5] flex items-center justify-center bg-muted">
                                    <div className="text-center">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
                                        <p className="text-sm text-muted-foreground font-light">Creating photo...</p>
                                    </div>
                                </div>
                            ) : (
                                <img
                                    src={compositeImage || ''}
                                    alt="Final composite"
                                    className="max-h-[calc(100vh-220px)] w-auto object-contain"
                                />
                            )}
                        </div>
                    </motion.div>

                    {/* Actions panel */}
                    <ReviewActions
                        isCompositing={isCompositing}
                        isPrinting={isPrinting}
                        handlePrint={handlePrintWithReset}
                        printCopiesCount={printCopiesCount}
                        handleNewSession={handleNewSession}
                        autoResetCountdown={autoResetCountdown}
                    >
                        <ReviewQRCode
                            downloadQR={downloadQR}
                            uploadError={uploadError}
                            isCompositing={isCompositing}
                            uploadStatus={uploadStatus}
                            handleRetryUpload={() => compositeImage && uploadAndGenerateQR(compositeImage)}
                        />
                    </ReviewActions>
                </div>

                {/* Processing indicator */}
                {isUploading && (
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute bottom-8 text-xs text-muted-foreground flex items-center gap-2"
                    >
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {uploadStatus || 'Processing...'}
                    </motion.p>
                )}

                {/* Printing overlay modal */}
                {isPrinting && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-2xl p-10 shadow-2xl flex flex-col items-center gap-6 min-w-[280px]"
                        >
                            <div className="relative">
                                <Printer className="w-12 h-12 text-primary" strokeWidth={1.5} />
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                    className="absolute -inset-3"
                                >
                                    <div className="w-full h-full rounded-full border-2 border-primary/20 border-t-primary" />
                                </motion.div>
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-medium text-foreground mb-1">Printing Your Photo</h3>
                                <p className="text-sm text-muted-foreground">Please wait...</p>
                            </div>
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        </motion.div>
                    </motion.div>
                )}
            </motion.div>
        </BoothErrorBoundary>
    );
}
