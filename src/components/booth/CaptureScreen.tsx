'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera as CameraIcon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
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

    const { selectedCameraId } = useAdminStore();
    const { stream, getScreenshot, isCameraReady: cameraReady, cameraError } = useCamera();
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
        handleRetake,
        handleContinue,
        retakePhoto,
    } = useCaptureFlow(getScreenshot, cameraReady);

    return (
        <BoothErrorBoundary fallbackMessage="Camera issue detected. Please return to the start screen.">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="min-h-screen flex bg-white kiosk relative overflow-hidden"
            >
                {/* Photo counter - minimal */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                    <div className="px-6 py-3 rounded-full bg-white border border-border elegant-shadow">
                        <p className="text-base font-light text-foreground">
                            Photo {currentPhotoIndex + 1} of {totalPhotos}
                        </p>
                    </div>
                </div>

                {/* Main content - Split layout */}
                <div className="flex w-full h-screen p-6 pt-20 gap-6">
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
                            ) : (
                                <video
                                    ref={setVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="w-full h-full object-cover transform scale-x-[-1]"
                                />
                            )}

                            <CaptureOverlay
                                phase={phase}
                                countdown={countdown}
                                previewCountdown={previewCountdown}
                                flashActive={flashActive}
                                cameraReady={cameraReady}
                                handleRetake={handleRetake}
                                handleContinue={handleContinue}
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
