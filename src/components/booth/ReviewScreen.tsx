'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Loader2, Printer } from 'lucide-react';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';

import { useCompositing } from '@/hooks/useCompositing';
import { useUploadSession } from '@/hooks/useUploadSession';
import { usePrintHandler } from '@/hooks/usePrintHandler';

import { ReviewActions } from './ReviewActions';
import { ReviewQRCode } from './ReviewQRCode';
import { BoothErrorBoundary } from './BoothErrorBoundary';
import { getAssetUrl } from '@/lib/api';

export function ReviewScreen() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const { setStep, resetSession, finalVideoUrl, selectedFrame, capturedPhotos } = useBoothStore();
    const { isVideoMode } = useAdminStore();
    const { booth } = useTenantStore();
    const timeoutSeconds = booth?.review_timeout_seconds ?? 60;

    const [autoResetCountdown, setAutoResetCountdown] = useState(timeoutSeconds);
    const [compositeRetryNonce, setCompositeRetryNonce] = useState(0);

    const { compositeImage, isCompositing, compositeWarning } = useCompositing(canvasRef, compositeRetryNonce);
    const {
        downloadQR, isUploading, uploadStatus,
        uploadError, uploadAndGenerateQR
    } = useUploadSession();
    const { isPrinting, handlePrint, printCopiesCount } = usePrintHandler(compositeImage);
    const compositeFailed = !isCompositing && !compositeImage;
    const effectiveUploadError = uploadError || (compositeFailed ? 'Final preview generation failed. Please retry.' : null);

    // Log & alert when compositing finishes — helps operators spot blank-frame issues immediately
    const hasLoggedResultRef = useRef(false);
    useEffect(() => {
        if (isCompositing || hasLoggedResultRef.current) return;
        hasLoggedResultRef.current = true;

        if (compositeFailed) {
            console.error('[ReviewScreen] ⚠️ Compositing finished but produced NO image.');
        } else if (compositeImage) {
            const sizeKB = Math.round((compositeImage.length * 3) / 4 / 1024);
            console.log(`[ReviewScreen] Compositing done — image ≈ ${sizeKB} KB`);
        }
        if (compositeWarning) {
            console.warn(`[ReviewScreen] ⚠️ Warning: ${compositeWarning}`);
        }
    }, [isCompositing, compositeFailed, compositeImage, compositeWarning]);

    // Trigger upload when compositing completes
    const hasUploadedRef = useRef(false);
    useEffect(() => {
        if (compositeImage && !hasUploadedRef.current) {
            hasUploadedRef.current = true;
            uploadAndGenerateQR(compositeImage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compositeImage]);

    const handleRetryComposite = () => {
        setCompositeRetryNonce((prev) => prev + 1);
    };

    // Auto-reset timer — pause when compositing, printing, or a compositing warning is active
    useEffect(() => {
        if (isCompositing || isPrinting || compositeWarning) return;
        if (autoResetCountdown <= 0) return;

        const timer = setInterval(() => {
            setAutoResetCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(timer);
    }, [isCompositing, isPrinting, autoResetCountdown, compositeWarning]);

    // Navigate to idle when countdown reaches 0
    useEffect(() => {
        if (autoResetCountdown === 0 && !isCompositing && !isPrinting && !compositeWarning) {
            resetSession();
            setStep('idle');
        }
    }, [autoResetCountdown, isCompositing, isPrinting, compositeWarning, resetSession, setStep]);

    // When a compositing warning appears, reset countdown so operator has full time
    useEffect(() => {
        if (compositeWarning) {
            setAutoResetCountdown(timeoutSeconds);
        }
    }, [compositeWarning, timeoutSeconds]);

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

                {/* Auto-reset countdown overlay */}
                <div className="absolute top-6 left-6 z-30">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={autoResetCountdown}
                            initial={{ scale: 1.3, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.7, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            className="w-20 h-20 rounded-xl bg-white/90 backdrop-blur flex items-center justify-center elegant-shadow"
                        >
                            <span className="text-4xl font-light text-foreground">
                                {autoResetCountdown}
                            </span>
                        </motion.div>
                    </AnimatePresence>
                </div>

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
                                <div className="w-48 aspect-3/5 flex items-center justify-center bg-muted">
                                    <div className="text-center">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
                                        <p className="text-sm text-muted-foreground font-light">Creating photo...</p>
                                    </div>
                                </div>
                            ) : compositeFailed ? (
                                <div className="w-48 aspect-3/5 flex items-center justify-center bg-muted/40 border border-dashed border-border rounded-xl p-4">
                                    <div className="text-center">
                                        <p className="text-sm text-foreground mb-2">Couldn&apos;t render final preview</p>
                                        <p className="text-[11px] text-muted-foreground mb-4">Retry compositing to continue</p>
                                        <button
                                            type="button"
                                            onClick={handleRetryComposite}
                                            className="px-4 py-2 rounded-full border border-border text-xs hover:bg-muted transition-colors"
                                        >
                                            Retry Preview
                                        </button>
                                    </div>
                                </div>
                            ) : isVideoMode && selectedFrame ? (
                                (() => {
                                    const cw = selectedFrame.canvas_width || 600;
                                    const ch = selectedFrame.canvas_height || 1050;
                                    const maxH = 750;
                                    const availableH = typeof window !== 'undefined' ? window.innerHeight - 220 : maxH;
                                    const scale = Math.min(Math.min(maxH, availableH) / ch, 1);
                                    const pw = Math.round(cw * scale);
                                    const ph = Math.round(ch * scale);

                                    return (
                                        <div 
                                            className="relative overflow-hidden bg-white" 
                                            style={{ 
                                                width: `${pw}px`, 
                                                height: `${ph}px`,
                                            }}
                                        >
                                            {selectedFrame.photo_slots?.filter((slot) => slot.layer !== 'above').map((slot, i) => {
                                                const originalIndex = slot.capture_index ?? i;
                                                const photo = capturedPhotos[originalIndex];
                                                return (
                                                    <div
                                                        key={slot.id || `slot-${i}`}
                                                        className="absolute overflow-hidden z-10"
                                                        style={{
                                                            left: `${(slot.x / cw) * 100}%`,
                                                            top: `${(slot.y / ch) * 100}%`,
                                                            width: `${(slot.width / cw) * 100}%`,
                                                            height: `${(slot.height / ch) * 100}%`,
                                                            transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                                        }}
                                                    >
                                                        {photo?.videoUrl ? (
                                                            <video
                                                                src={photo.videoUrl}
                                                                autoPlay
                                                                loop
                                                                muted
                                                                playsInline
                                                                className="w-full h-full object-cover"
                                                                style={{ objectFit: 'cover' }}
                                                            />
                                                        ) : photo?.dataUrl ? (
                                                            <img
                                                                src={photo.dataUrl}
                                                                alt={`Photo ${originalIndex + 1}`}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : null}
                                                    </div>
                                                );
                                            })}

                                            <img
                                                src={getAssetUrl(selectedFrame.image_url)}
                                                alt="Frame"
                                                className="absolute inset-0 w-full h-full object-contain z-20 pointer-events-none"
                                            />

                                            {selectedFrame.photo_slots?.filter((slot) => slot.layer === 'above').map((slot, i) => {
                                                const originalIndex = slot.capture_index ?? i;
                                                const photo = capturedPhotos[originalIndex];
                                                return (
                                                    <div
                                                        key={`above-${slot.id || i}`}
                                                        className="absolute overflow-hidden z-30"
                                                        style={{
                                                            left: `${(slot.x / cw) * 100}%`,
                                                            top: `${(slot.y / ch) * 100}%`,
                                                            width: `${(slot.width / cw) * 100}%`,
                                                            height: `${(slot.height / ch) * 100}%`,
                                                            transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                                        }}
                                                    >
                                                        {photo?.videoUrl ? (
                                                            <video
                                                                src={photo.videoUrl}
                                                                autoPlay
                                                                loop
                                                                muted
                                                                playsInline
                                                                className="w-full h-full object-cover"
                                                                style={{ objectFit: 'cover' }}
                                                            />
                                                        ) : photo?.dataUrl ? (
                                                            <img
                                                                src={photo.dataUrl}
                                                                alt={`Photo ${originalIndex + 1}`}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()
                            ) : (
                                    <img
                                        src={compositeImage || ''}
                                        alt="Final composite"
                                        className="max-h-[calc(100vh-220px)] w-auto object-contain"
                                    />
                            )}
                        </div>
                    </motion.div>

                    {/* Compositing warning banner — placed OUTSIDE the card so it's always visible */}
                    {compositeWarning && !isCompositing && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-xl w-[90%] bg-amber-500 text-white text-sm px-5 py-3 rounded-xl text-center shadow-lg z-50">
                            <p className="font-semibold mb-1">⚠ Compositing Issue Detected</p>
                            <p className="text-xs opacity-90 mb-2">{compositeWarning}</p>
                            <button
                                type="button"
                                onClick={handleRetryComposite}
                                className="px-4 py-1.5 bg-white text-amber-700 rounded-full text-xs font-semibold hover:bg-amber-50 transition-colors"
                            >
                                Retry Compositing
                            </button>
                        </div>
                    )}

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
                            uploadError={effectiveUploadError}
                            isCompositing={isCompositing}
                            uploadStatus={uploadStatus}
                            handleRetryUpload={() => {
                                if (compositeFailed) {
                                    handleRetryComposite();
                                    return;
                                }
                                if (compositeImage) {
                                    uploadAndGenerateQR(compositeImage);
                                }
                            }}
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
                            className="bg-white rounded-2xl p-10 shadow-2xl flex flex-col items-center gap-6 min-w-70"
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
