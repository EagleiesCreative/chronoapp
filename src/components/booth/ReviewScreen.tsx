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
import { getApiUrl, getAssetUrl } from '@/lib/api';

const PRINT_4R_WIDTH = 1200;
const PRINT_4R_HEIGHT = 1800;

type FallbackSlot = {
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    layer?: string;
    capture_index?: number;
};

type FallbackFrame = {
    canvas_width?: number;
    canvas_height?: number;
    image_url: string;
    photo_slots?: FallbackSlot[];
};

type FallbackPhoto = {
    dataUrl?: string | null;
    videoBlob?: Blob;
};

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Failed to convert blob to data URL'));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function loadImageFromSrc(src: string, timeoutMs: number = 8000): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timer = setTimeout(() => reject(new Error('Image load timeout')), timeoutMs);

        if (!src.startsWith('data:')) {
            img.crossOrigin = 'anonymous';
        }

        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Image load error'));
        };

        img.src = src;
    });
}

function drawImageCoverInRect(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    destX: number,
    destY: number,
    destW: number,
    destH: number,
    rotation: number = 0
) {
    if (sourceWidth <= 0 || sourceHeight <= 0 || destW <= 0 || destH <= 0) return;

    const sourceAspect = sourceWidth / sourceHeight;
    const destAspect = destW / destH;

    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (sourceAspect > destAspect) {
        sw = sourceHeight * destAspect;
        sx = (sourceWidth - sw) / 2;
    } else {
        sh = sourceWidth / destAspect;
        sy = (sourceHeight - sh) / 2;
    }

    ctx.save();
    if (rotation) {
        ctx.translate(destX + destW / 2, destY + destH / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-(destX + destW / 2), -(destY + destH / 2));
    }

    ctx.drawImage(image, sx, sy, sw, sh, destX, destY, destW, destH);
    ctx.restore();
}

async function isLikelyBlankComposite(dataUrl: string): Promise<boolean> {
    try {
        const img = await loadImageFromSrc(dataUrl, 5000);
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 32, 32);
        ctx.drawImage(img, 0, 0, 32, 32);

        const pixels = ctx.getImageData(0, 0, 32, 32).data;
        let nonWhiteCount = 0;

        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];
            const isWhite = r >= 245 && g >= 245 && b >= 245;
            const isTransparent = a < 10;

            if (!isWhite && !isTransparent) {
                nonWhiteCount += 1;
                if (nonWhiteCount > 8) return false;
            }
        }

        return true;
    } catch {
        return false;
    }
}

async function resolveFrameToDataUrl(frameUrl: string): Promise<string | null> {
    const assetUrl = getAssetUrl(frameUrl);
    if (!assetUrl) return null;
    if (assetUrl.startsWith('data:')) return assetUrl;

    const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { signal: controller.signal });
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const candidates: string[] = [];
    if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
        candidates.push(getApiUrl(`/api/frames/image?url=${encodeURIComponent(assetUrl)}`));
    }
    candidates.push(assetUrl);

    for (const candidate of candidates) {
        try {
            const response = await fetchWithTimeout(candidate, 4500);
            if (!response.ok) continue;
            const blob = await response.blob();
            if (blob.size === 0) continue;
            return await blobToDataUrl(blob);
        } catch {
            // Try next candidate
        }
    }

    return null;
}

async function buildPrintImage(finalDataUrl: string, canvasWidth: number, shouldDuplicate2R: boolean): Promise<string | null> {
    if (!shouldDuplicate2R) return finalDataUrl;

    try {
        const img = await loadImageFromSrc(finalDataUrl);
        const printCanvas = document.createElement('canvas');
        printCanvas.width = PRINT_4R_WIDTH;
        printCanvas.height = PRINT_4R_HEIGHT;

        const printCtx = printCanvas.getContext('2d');
        if (!printCtx) return finalDataUrl;

        printCtx.fillStyle = '#ffffff';
        printCtx.fillRect(0, 0, PRINT_4R_WIDTH, PRINT_4R_HEIGHT);
        printCtx.drawImage(img, 0, 0, canvasWidth, PRINT_4R_HEIGHT);
        printCtx.drawImage(img, canvasWidth, 0, canvasWidth, PRINT_4R_HEIGHT);

        return printCanvas.toDataURL('image/jpeg', 0.95);
    } catch {
        return finalDataUrl;
    }
}

async function buildFallbackCompositeImage(
    frame: FallbackFrame | null,
    photos: FallbackPhoto[]
): Promise<string | null> {
    if (!frame || photos.length === 0) return null;

    const canvasWidth = frame.canvas_width || 1200;
    const canvasHeight = frame.canvas_height || 1800;

    const slots = (frame.photo_slots || [])
        .map((slot, index) => {
            const captureIndex = Number(slot.capture_index);
            return {
                ...slot,
                x: Number(slot.x),
                y: Number(slot.y),
                width: Number(slot.width),
                height: Number(slot.height),
                rotation: Number.isFinite(Number(slot.rotation)) ? Number(slot.rotation) : 0,
                layer: slot.layer === 'above' ? 'above' : 'below',
                capture_index: Number.isInteger(captureIndex) ? captureIndex : index,
            } as FallbackSlot;
        })
        .filter((slot) => Number.isFinite(slot.x) && Number.isFinite(slot.y) && slot.width > 0 && slot.height > 0);

    if (slots.length === 0) {
        const fallbackPhoto = photos.find((p) => !!p.dataUrl)?.dataUrl || null;
        return fallbackPhoto || null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imageCache = new Map<string, HTMLImageElement>();

    const drawSlot = async (slot: FallbackSlot, slotIndex: number) => {
        const captureIdx = slot.capture_index ?? slotIndex;
        const photo = photos[captureIdx] || photos[slotIndex] || photos[0];
        const photoSrc = photo?.dataUrl || null;
        if (!photoSrc) return;

        let image = imageCache.get(photoSrc);
        if (!image) {
            image = await loadImageFromSrc(photoSrc);
            imageCache.set(photoSrc, image);
        }

        drawImageCoverInRect(
            ctx,
            image,
            image.naturalWidth,
            image.naturalHeight,
            slot.x,
            slot.y,
            slot.width,
            slot.height,
            slot.rotation || 0
        );
    };

    try {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        for (let i = 0; i < slots.length; i++) {
            if (slots[i].layer === 'above') continue;
            await drawSlot(slots[i], i);
        }

        const frameDataUrl = await resolveFrameToDataUrl(frame.image_url);
        if (frameDataUrl) {
            try {
                const frameImg = await loadImageFromSrc(frameDataUrl);
                ctx.drawImage(frameImg, 0, 0, canvasWidth, canvasHeight);
            } catch {
                // Frame overlay is optional for fallback flow.
            }
        }

        for (let i = 0; i < slots.length; i++) {
            if (slots[i].layer !== 'above') continue;
            await drawSlot(slots[i], i);
        }

        return canvas.toDataURL('image/jpeg', 0.95);
    } catch {
        return photos.find((p) => !!p.dataUrl)?.dataUrl || null;
    }
}

export function ReviewScreen() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const {
        setStep,
        resetSession,
        selectedFrame,
        capturedPhotos,
        setFinalImage,
        setPrintImage,
    } = useBoothStore();
    const { isVideoMode } = useAdminStore();

    const { booth } = useTenantStore();
    const timeoutSeconds = booth?.review_timeout_seconds ?? 60;

    const [autoResetCountdown, setAutoResetCountdown] = useState(timeoutSeconds);
    const [compositeRetryNonce, setCompositeRetryNonce] = useState(0);
    const [effectiveCompositeImage, setEffectiveCompositeImage] = useState<string | null>(null);
    const [isResolvingComposite, setIsResolvingComposite] = useState(false);
    const [usedFallbackPreview, setUsedFallbackPreview] = useState(false);
    const [liveSlotVideoUrls, setLiveSlotVideoUrls] = useState<Record<number, string>>({});

    const { compositeImage, isCompositing, compositeWarning } = useCompositing(canvasRef, compositeRetryNonce);

    const {
        downloadQR,
        isUploading,
        uploadStatus,
        uploadError,
        uploadAndGenerateQR,
    } = useUploadSession();

    const { isPrinting, handlePrint, printCopiesCount } = usePrintHandler(effectiveCompositeImage);

    const hasPotentialLiveClips =
        isVideoMode && capturedPhotos.some((photo) => !!photo.videoBlob && photo.videoBlob.size > 0);

    const compositeFailed =
        !isCompositing &&
        !isResolvingComposite &&
        !effectiveCompositeImage &&
        !hasPotentialLiveClips;
    const effectiveUploadError = uploadError || (compositeFailed ? 'Final preview generation failed. Please retry.' : null);

    useEffect(() => {
        const urls: Record<number, string> = {};

        capturedPhotos.forEach((photo, index) => {
            if (photo.videoBlob && photo.videoBlob.size > 0) {
                urls[index] = URL.createObjectURL(photo.videoBlob);
            }
        });

        setLiveSlotVideoUrls(urls);

        return () => {
            Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
        };
    }, [capturedPhotos]);

    const previewSlots = (selectedFrame?.photo_slots || [])
        .map((slot, index) => {
            const captureIndex = Number(slot.capture_index);
            return {
                ...slot,
                x: Number(slot.x),
                y: Number(slot.y),
                width: Number(slot.width),
                height: Number(slot.height),
                rotation: Number.isFinite(Number(slot.rotation)) ? Number(slot.rotation) : 0,
                layer: slot.layer === 'above' ? 'above' : 'below',
                capture_index: Number.isInteger(captureIndex) ? captureIndex : index,
            };
        })
        .filter((slot) => Number.isFinite(slot.x) && Number.isFinite(slot.y) && slot.width > 0 && slot.height > 0);

    const shouldShowLivePreview =
        isVideoMode &&
        !!selectedFrame &&
        hasPotentialLiveClips &&
        previewSlots.length > 0;

    const previewCanvasWidth = selectedFrame?.canvas_width || 600;
    const previewCanvasHeight = selectedFrame?.canvas_height || 1050;
    const previewMaxHeight = typeof window !== 'undefined' ? Math.max(360, window.innerHeight - 220) : 750;
    const previewScale = Math.min(previewMaxHeight / previewCanvasHeight, 1);
    const previewWidth = Math.round(previewCanvasWidth * previewScale);
    const previewHeight = Math.round(previewCanvasHeight * previewScale);

    useEffect(() => {
        let cancelled = false;

        const resolveCompositePreview = async () => {
            if (isCompositing) {
                setIsResolvingComposite(false);
                // Keep the previous resolved preview while recompositing runs,
                // otherwise users can get stuck looking at a spinner even after QR is ready.
                return;
            }

            setIsResolvingComposite(true);

            const candidate = compositeImage;
            let needsFallback = !candidate;

            if (candidate && !needsFallback) {
                const blank = await isLikelyBlankComposite(candidate);
                if (cancelled) return;
                needsFallback = blank;
            }

            if (needsFallback) {
                const fallback = await buildFallbackCompositeImage(selectedFrame, capturedPhotos);
                if (cancelled) return;

                if (fallback) {
                    const canvasWidth = selectedFrame?.canvas_width || 1200;
                    const shouldDuplicate2R = canvasWidth <= 600;
                    const printDataUrl = await buildPrintImage(fallback, canvasWidth, shouldDuplicate2R);

                    if (cancelled) return;

                    setUsedFallbackPreview(true);
                    setEffectiveCompositeImage(fallback);
                    setFinalImage(fallback);
                    setPrintImage(printDataUrl || fallback);
                    setIsResolvingComposite(false);
                    return;
                }

                // Keep showing the existing candidate (if any) when fallback generation fails.
                if (candidate) {
                    setUsedFallbackPreview(false);
                    setEffectiveCompositeImage(candidate);
                    setIsResolvingComposite(false);
                    return;
                }
            }

            if (cancelled) return;

            setUsedFallbackPreview(false);
            setEffectiveCompositeImage(candidate || null);
            setIsResolvingComposite(false);
        };

        void resolveCompositePreview();

        return () => {
            cancelled = true;
        };
    }, [
        isCompositing,
        compositeImage,
        compositeWarning,
        selectedFrame,
        capturedPhotos,
        setFinalImage,
        setPrintImage,
    ]);

    const autoRecoveryAttemptedRef = useRef(false);
    useEffect(() => {
        autoRecoveryAttemptedRef.current = false;
    }, [compositeRetryNonce, selectedFrame?.id]);

    useEffect(() => {
        if (isCompositing || isResolvingComposite) return;
        if (effectiveCompositeImage) return;
        if (!selectedFrame || capturedPhotos.length === 0) return;
        if (hasPotentialLiveClips) return;
        if (autoRecoveryAttemptedRef.current) return;

        autoRecoveryAttemptedRef.current = true;
        console.warn('[ReviewScreen] Auto-retrying compositing once because preview image is still empty.');
        setCompositeRetryNonce((prev) => prev + 1);
    }, [
        isCompositing,
        isResolvingComposite,
        effectiveCompositeImage,
        selectedFrame,
        capturedPhotos.length,
        hasPotentialLiveClips,
    ]);

    const hasLoggedResultRef = useRef(false);
    useEffect(() => {
        hasLoggedResultRef.current = false;
    }, [compositeRetryNonce]);

    useEffect(() => {
        if (isCompositing || isResolvingComposite || hasLoggedResultRef.current) return;
        hasLoggedResultRef.current = true;

        if (compositeFailed) {
            console.error('[ReviewScreen] Compositing finished but no usable preview image was produced.');
        } else if (!effectiveCompositeImage && shouldShowLivePreview) {
            console.warn('[ReviewScreen] Live preview is active without a static composite image yet.');
        } else if (usedFallbackPreview) {
            console.warn('[ReviewScreen] Using fallback composite renderer for this session.');
        } else if (effectiveCompositeImage) {
            const sizeKB = Math.round((effectiveCompositeImage.length * 3) / 4 / 1024);
            console.log(`[ReviewScreen] Compositing done - image approx ${sizeKB} KB`);
        }

        if (compositeWarning) {
            console.warn(`[ReviewScreen] Compositing warning: ${compositeWarning}`);
        }
    }, [
        isCompositing,
        isResolvingComposite,
        compositeFailed,
        usedFallbackPreview,
        effectiveCompositeImage,
        compositeWarning,
        shouldShowLivePreview,
    ]);

    const hasUploadedRef = useRef(false);
    useEffect(() => {
        hasUploadedRef.current = false;
    }, [compositeRetryNonce]);

    useEffect(() => {
        if (effectiveCompositeImage && !hasUploadedRef.current) {
            hasUploadedRef.current = true;
            uploadAndGenerateQR(effectiveCompositeImage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveCompositeImage]);

    const handleRetryComposite = () => {
        hasUploadedRef.current = false;
        hasLoggedResultRef.current = false;
        autoRecoveryAttemptedRef.current = false;
        setCompositeRetryNonce((prev) => prev + 1);
    };

    useEffect(() => {
        if (isCompositing || isResolvingComposite || isPrinting || compositeWarning) return;
        if (autoResetCountdown <= 0) return;

        const timer = setInterval(() => {
            setAutoResetCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(timer);
    }, [isCompositing, isResolvingComposite, isPrinting, compositeWarning, autoResetCountdown]);

    useEffect(() => {
        if (autoResetCountdown === 0 && !isCompositing && !isResolvingComposite && !isPrinting && !compositeWarning) {
            resetSession();
            setStep('idle');
        }
    }, [autoResetCountdown, isCompositing, isResolvingComposite, isPrinting, compositeWarning, resetSession, setStep]);

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
                <canvas ref={canvasRef} className="hidden" />

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
                            <span className="text-4xl font-light text-foreground">{autoResetCountdown}</span>
                        </motion.div>
                    </AnimatePresence>
                </div>

                <motion.div
                    initial={{ y: -20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-center shrink-0 mb-4"
                >
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-border mb-2">
                        <CheckCircle className="w-5 h-5 text-primary" strokeWidth={1.5} />
                    </div>
                    <h2 className="text-xl font-light mb-1">Your Photo is Ready</h2>
                    <p className="text-muted-foreground font-light text-sm">Print or download your photo</p>
                    {booth?.brand_logo_url && (
                        <img src={booth.brand_logo_url} alt="Logo" className="h-8 w-auto mx-auto mt-2 object-contain opacity-80" />
                    )}
                    {booth?.event_mode && booth?.event_message && (
                        <p className="text-xs text-primary font-medium mt-1">{booth.event_message}</p>
                    )}
                </motion.div>

                <div className="flex-1 flex gap-8 items-center w-full max-w-4xl justify-center py-4">
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="flex flex-col items-center justify-center"
                    >
                        <div className="elegant-card overflow-hidden">
                            {shouldShowLivePreview ? (
                                <div
                                    className="relative bg-white"
                                    style={{ width: `${previewWidth}px`, height: `${previewHeight}px` }}
                                >
                                    {previewSlots.filter((slot) => slot.layer !== 'above').map((slot, index) => {
                                        const captureIdx = slot.capture_index ?? index;
                                        const slotVideoUrl = liveSlotVideoUrls[captureIdx];
                                        const slotPhoto = capturedPhotos[captureIdx]?.dataUrl;

                                        return (
                                            <div
                                                key={`slot-below-${slot.id || index}`}
                                                className="absolute overflow-hidden z-10"
                                                style={{
                                                    left: `${(slot.x / previewCanvasWidth) * 100}%`,
                                                    top: `${(slot.y / previewCanvasHeight) * 100}%`,
                                                    width: `${(slot.width / previewCanvasWidth) * 100}%`,
                                                    height: `${(slot.height / previewCanvasHeight) * 100}%`,
                                                    transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                                }}
                                            >
                                                {slotVideoUrl ? (
                                                    <video
                                                        src={slotVideoUrl}
                                                        autoPlay
                                                        loop
                                                        muted
                                                        playsInline
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : slotPhoto ? (
                                                    <img
                                                        src={slotPhoto}
                                                        alt={`Photo ${captureIdx + 1}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : null}
                                            </div>
                                        );
                                    })}

                                    <img
                                        src={getAssetUrl(selectedFrame!.image_url)}
                                        alt="Frame"
                                        className="absolute inset-0 w-full h-full object-contain z-20 pointer-events-none"
                                    />

                                    {previewSlots.filter((slot) => slot.layer === 'above').map((slot, index) => {
                                        const captureIdx = slot.capture_index ?? index;
                                        const slotVideoUrl = liveSlotVideoUrls[captureIdx];
                                        const slotPhoto = capturedPhotos[captureIdx]?.dataUrl;

                                        return (
                                            <div
                                                key={`slot-above-${slot.id || index}`}
                                                className="absolute overflow-hidden z-30"
                                                style={{
                                                    left: `${(slot.x / previewCanvasWidth) * 100}%`,
                                                    top: `${(slot.y / previewCanvasHeight) * 100}%`,
                                                    width: `${(slot.width / previewCanvasWidth) * 100}%`,
                                                    height: `${(slot.height / previewCanvasHeight) * 100}%`,
                                                    transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                                }}
                                            >
                                                {slotVideoUrl ? (
                                                    <video
                                                        src={slotVideoUrl}
                                                        autoPlay
                                                        loop
                                                        muted
                                                        playsInline
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : slotPhoto ? (
                                                    <img
                                                        src={slotPhoto}
                                                        alt={`Photo ${captureIdx + 1}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : isCompositing ? (
                                <div className="w-48 aspect-3/5 flex items-center justify-center bg-muted">
                                    <div className="text-center">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
                                        <p className="text-sm text-muted-foreground font-light">Finalizing preview...</p>
                                    </div>
                                </div>
                            ) : isResolvingComposite ? (
                                <div className="w-48 aspect-3/5 flex items-center justify-center bg-muted">
                                    <div className="text-center">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
                                        <p className="text-sm text-muted-foreground font-light">Finalizing preview...</p>
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
                            ) : (
                                <img
                                    src={effectiveCompositeImage || ''}
                                    alt="Final composite"
                                    className="max-h-[calc(100vh-220px)] w-auto object-contain"
                                />
                            )}
                        </div>

                        {usedFallbackPreview && !isCompositing && !isResolvingComposite && (
                            <p className="mt-2 text-[11px] text-amber-700 text-center">
                                Fallback renderer recovered this preview from captured photos.
                            </p>
                        )}

                        {shouldShowLivePreview && (
                            <p className="mt-2 text-[11px] text-primary text-center">
                                Live mode preview playing inside frame
                            </p>
                        )}
                    </motion.div>

                    {compositeWarning && !isCompositing && !isResolvingComposite && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-xl w-[90%] bg-amber-500 text-white text-sm px-5 py-3 rounded-xl text-center shadow-lg z-50">
                            <p className="font-semibold mb-1">Compositing Warning</p>
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

                    <ReviewActions
                        isCompositing={isCompositing || isResolvingComposite}
                        isPrinting={isPrinting}
                        handlePrint={handlePrintWithReset}
                        printCopiesCount={printCopiesCount}
                        handleNewSession={handleNewSession}
                        autoResetCountdown={autoResetCountdown}
                    >
                        <ReviewQRCode
                            downloadQR={downloadQR}
                            uploadError={effectiveUploadError}
                            isCompositing={isCompositing || isResolvingComposite}
                            uploadStatus={uploadStatus}
                            handleRetryUpload={() => {
                                if (compositeFailed) {
                                    handleRetryComposite();
                                    return;
                                }

                                if (effectiveCompositeImage) {
                                    uploadAndGenerateQR(effectiveCompositeImage);
                                } else {
                                    handleRetryComposite();
                                }
                            }}
                        />
                    </ReviewActions>
                </div>

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
                                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
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
