'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera as CameraIcon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { LiveViewImage } from './LiveViewImage';
import { useCamera } from './CameraProvider';
import { getCachedImageUrl } from '@/lib/frame-cache';

import { useCaptureFlow } from '@/hooks/useCaptureFlow';
import { CaptureOverlay } from './CaptureOverlay';
import { PhotoSlotGrid } from './PhotoSlotGrid';
import { BoothErrorBoundary } from './BoothErrorBoundary';

export function CaptureScreen() {
    const {
        selectedFrame,
        // ... skipping some lines for brevity in instruction, using actual lines from file below ...
        currentPhotoIndex,
        capturedPhotos,
    } = useBoothStore();

    const { selectedCameraId, isCameraMirrored } = useAdminStore();
    const { stream, getScreenshot, getBackendCapture, isCameraReady: cameraReady, cameraError, isBackendMode } = useCamera();
    const [cachedOverlayUrl, setCachedOverlayUrl] = useState<string | null>(null);

    useEffect(() => {
        if (selectedFrame?.image_url) {
            getCachedImageUrl(selectedFrame.image_url).then(url => {
                setCachedOverlayUrl(url);
            });
        }
    }, [selectedFrame]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
        videoRef.current = node;
        if (node && stream) {
            node.srcObject = stream;
        }
    }, [stream]);

    const isMediaSupported = typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function';

    const {
        phase,
        countdown,
        previewCountdown,
        flashActive,
        lastCapturedPhoto,
        totalPhotos,
        retakingIndex,
        retakePhoto,
        startCountdown,
    } = useCaptureFlow(getScreenshot, cameraReady, stream, getBackendCapture, isBackendMode);


    return (
        <BoothErrorBoundary fallbackMessage="Camera issue detected. Please return to the start screen.">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full w-full flex bg-white kiosk relative overflow-hidden"
            >
                {/* Photo counter - refined studio pill */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                    <div className="px-6 py-2.5 rounded-full bg-white/95 backdrop-blur-sm border border-border/80 elegant-shadow flex items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-primary" />
                        <p className="text-base font-medium text-foreground tracking-wide">
                            Photo {currentPhotoIndex + 1} <span className="text-muted-foreground font-light">of {totalPhotos}</span>
                        </p>
                    </div>
                </div>

                {/* Main content - Split layout */}
                <div className="flex w-full h-full p-6 pt-20 gap-6">
                    {/* LEFT SIDE - Camera Preview */}
                    <div className="flex-[2] flex items-center justify-center relative">
                        <div className="relative w-full h-full max-w-[850px] max-h-[650px] rounded-2xl overflow-hidden border border-border elegant-shadow">
                            {!isMediaSupported ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-muted">
                                    <CameraIcon className="w-16 h-16 text-muted-foreground mb-6" strokeWidth={1} />
                                    <p className="text-muted-foreground font-light text-center px-4 mb-4">
                                        Camera access is not available
                                    </p>
                                    <Button
                                        onClick={() => window.location.reload()}
                                        variant="outline"
                                        className="rounded-full"
                                    >
                                        <RefreshCw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                        Retry
                                    </Button>
                                </div>
                            ) : cameraError ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-muted">
                                    <CameraIcon className="w-16 h-16 text-muted-foreground mb-6" strokeWidth={1} />
                                    <p className="text-muted-foreground font-light text-center px-4 mb-4">
                                        {cameraError}
                                    </p>
                                    <Button
                                        onClick={() => window.location.reload()}
                                        variant="outline"
                                        className="rounded-full"
                                    >
                                        <RefreshCw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                        Retry
                                    </Button>
                                </div>
                            ) : phase === 'preview' && lastCapturedPhoto ? (
                                <img
                                    src={lastCapturedPhoto}
                                    alt="Captured preview"
                                    className="w-full h-full object-cover"
                                />
                            ) : isBackendMode ? (
                                /* Sony/Canon: MJPEG live view from the backend stream server */
                                <LiveViewImage
                                    alt="Live View"
                                    className={`w-full h-full object-cover transform ${isCameraMirrored ? 'scale-x-[-1]' : ''}`}
                                />
                            ) : (
                                <video
                                    ref={setVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className={`w-full h-full object-cover transform ${isCameraMirrored ? 'scale-x-[-1]' : ''}`}
                                />
                            )}

                            {/* TAP TO START WAIT OVERLAY */}
                            <AnimatePresence>
                                {phase === 'waiting' && cameraReady && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.3 }}
                                        onClick={startCountdown}
                                        className="absolute inset-0 z-40 flex items-center justify-center cursor-pointer bg-black/35 backdrop-blur-[2px]"
                                    >
                                        <div className="text-center flex flex-col items-center gap-4 px-8 py-6 rounded-3xl bg-black/30 border border-white/20 backdrop-blur-md">
                                            <div className="w-16 h-16 rounded-full bg-white/15 border border-white/30 flex items-center justify-center">
                                                <CameraIcon className="w-8 h-8 text-white" strokeWidth={1.5} />
                                            </div>
                                            <p
                                                className="text-white text-3xl md:text-4xl lg:text-5xl font-light tracking-[0.18em] animate-pulse"
                                                style={{ textShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
                                            >
                                                TAP TO START
                                            </p>
                                            <p className="text-white/75 text-xs uppercase tracking-[0.2em] font-medium">
                                                Get ready for your pose
                                            </p>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <CaptureOverlay
                                phase={phase}
                                countdown={countdown}
                                previewCountdown={previewCountdown}
                                flashActive={flashActive}
                                cameraReady={cameraReady}
                            />
                        </div>
                    </div>

                    {/* RIGHT SIDE - Frame Preview */}
                    <PhotoSlotGrid
                        selectedFrame={selectedFrame}
                        capturedPhotos={capturedPhotos}
                        currentPhotoIndex={currentPhotoIndex}
                        lastCapturedPhoto={lastCapturedPhoto}
                        cachedOverlayUrl={cachedOverlayUrl}
                        retakingIndex={retakingIndex}
                        onRetakeSlot={retakePhoto}
                    />
                </div>
            </motion.div>
        </BoothErrorBoundary>
    );
}
