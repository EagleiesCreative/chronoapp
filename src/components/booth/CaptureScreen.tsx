'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Webcam from 'react-webcam';
import { Camera as CameraIcon, RefreshCw, Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore, useAdminStore } from '@/store/booth-store';

type CapturePhase = 'countdown' | 'capturing' | 'preview';

export function CaptureScreen() {
    const webcamRef = useRef<Webcam>(null);
    const [flashActive, setFlashActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [cameraReady, setCameraReady] = useState(false);
    const [phase, setPhase] = useState<CapturePhase>('countdown');
    const [countdown, setCountdown] = useState(3);
    const [previewCountdown, setPreviewCountdown] = useState(5);
    const [lastCapturedPhoto, setLastCapturedPhoto] = useState<string | null>(null);

    const {
        selectedFrame,
        currentPhotoIndex,
        setCurrentPhotoIndex,
        addCapturedPhoto,
        capturedPhotos,
        setStep,
    } = useBoothStore();

    const { selectedCameraId } = useAdminStore();

    const isMediaSupported = typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function';

    const totalPhotos = selectedFrame?.photo_slots?.length || 3;

    const handleUserMediaError = useCallback((error: string | DOMException) => {
        console.error('Camera error:', error);
        if (typeof error === 'string') {
            setCameraError(error);
        } else {
            setCameraError(`Camera access denied: ${error.message}`);
        }
    }, []);

    const handleUserMedia = useCallback(() => {
        console.log('Camera ready');
        setCameraReady(true);
        setCameraError(null);
    }, []);

    // Countdown timer
    useEffect(() => {
        if (!cameraReady || phase !== 'countdown') return;

        if (countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            capturePhoto();
        }
    }, [cameraReady, countdown, phase]);

    // Preview auto-continue timer
    useEffect(() => {
        if (phase !== 'preview') return;

        if (previewCountdown > 0) {
            const timer = setTimeout(() => setPreviewCountdown(previewCountdown - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            handleContinue();
        }
    }, [phase, previewCountdown]);

    const capturePhoto = useCallback(() => {
        if (!webcamRef.current) return;

        setPhase('capturing');
        setFlashActive(true);

        setTimeout(() => {
            setFlashActive(false);
        }, 150);

        const imageSrc = webcamRef.current.getScreenshot();
        console.log('Screenshot captured:', !!imageSrc);

        if (imageSrc) {
            setLastCapturedPhoto(imageSrc);
            setPhase('preview');
            setPreviewCountdown(5);
        }
    }, []);

    const handleRetake = () => {
        setLastCapturedPhoto(null);
        setCountdown(3);
        setPhase('countdown');
    };

    const handleContinue = () => {
        if (lastCapturedPhoto) {
            addCapturedPhoto({
                index: currentPhotoIndex,
                dataUrl: lastCapturedPhoto,
            });

            if (currentPhotoIndex + 1 >= totalPhotos) {
                setStep('review');
            } else {
                setCurrentPhotoIndex(currentPhotoIndex + 1);
                setLastCapturedPhoto(null);
                setCountdown(3);
                setPhase('countdown');
            }
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-screen flex bg-white kiosk relative overflow-hidden"
        >
            {/* Flash effect */}
            <motion.div
                className="absolute inset-0 bg-white z-50 pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: flashActive ? 1 : 0 }}
                transition={{ duration: 0.1 }}
            />

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
                <div className="flex-[2] flex items-center justify-center">
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
                                style={{ transform: 'scaleX(-1)' }}
                            />
                        ) : (
                            /* Keep webcam always mounted - only show/hide captured photo */
                            <Webcam
                                ref={webcamRef}
                                audio={false}
                                screenshotFormat="image/jpeg"
                                screenshotQuality={1}
                                mirrored={true}
                                className="w-full h-full object-cover"
                                videoConstraints={{
                                    width: 1920,
                                    height: 1080,
                                    ...(selectedCameraId
                                        ? { deviceId: { exact: selectedCameraId } }
                                        : { facingMode: 'user' }),
                                }}
                                onUserMedia={handleUserMedia}
                                onUserMediaError={handleUserMediaError}
                            />
                        )}

                        {/* Countdown overlay */}
                        {phase === 'countdown' && cameraReady && (
                            <div className="absolute top-6 left-6 z-30">
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={countdown}
                                        initial={{ scale: 1.3, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        exit={{ scale: 0.7, opacity: 0 }}
                                        transition={{ duration: 0.25 }}
                                        className="w-20 h-20 rounded-xl bg-white/90 backdrop-blur flex items-center justify-center elegant-shadow"
                                    >
                                        <span className="text-4xl font-light text-foreground">
                                            {countdown > 0 ? countdown : '📸'}
                                        </span>
                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        )}

                        {/* Minimal corner guides */}
                        <div className="absolute top-4 left-4 w-10 h-10 border-l-2 border-t-2 border-white/60 rounded-tl-lg" />
                        <div className="absolute top-4 right-4 w-10 h-10 border-r-2 border-t-2 border-white/60 rounded-tr-lg" />
                        <div className="absolute bottom-4 left-4 w-10 h-10 border-l-2 border-b-2 border-white/60 rounded-bl-lg" />
                        <div className="absolute bottom-4 right-4 w-10 h-10 border-r-2 border-b-2 border-white/60 rounded-br-lg" />

                        {/* Status message */}
                        <motion.div
                            className="absolute bottom-6 left-1/2 -translate-x-1/2"
                            animate={{ opacity: [0.8, 1, 0.8] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                        >
                            {phase === 'countdown' && (
                                <div className="bg-white/90 backdrop-blur px-5 py-2 rounded-full elegant-shadow">
                                    <p className="text-foreground font-light text-sm">
                                        {countdown > 0 ? 'Get ready...' : 'Smile!'}
                                    </p>
                                </div>
                            )}
                            {phase === 'preview' && (
                                <div className="bg-primary/95 px-5 py-2 rounded-full elegant-shadow">
                                    <p className="text-primary-foreground font-light text-sm">
                                        Photo captured · Continue in {previewCountdown}s
                                    </p>
                                </div>
                            )}
                        </motion.div>

                        {/* Preview action buttons */}
                        {phase === 'preview' && (
                            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-3 z-30">
                                <Button
                                    onClick={handleRetake}
                                    variant="outline"
                                    className="bg-white/95 hover:bg-white rounded-full px-5"
                                >
                                    <RotateCcw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                    Retake
                                </Button>
                                <Button
                                    onClick={handleContinue}
                                    className="rounded-full px-5 elegant-shadow"
                                >
                                    <Check className="w-4 h-4 mr-2" strokeWidth={2} />
                                    Use Photo
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT SIDE - Frame Preview */}
                <div className="flex-1 flex flex-col items-center justify-center">
                    <div className="elegant-card p-4 rounded-xl">
                        <p className="text-center text-xs text-muted-foreground mb-3 font-light tracking-wide">Preview</p>

                        {/* Frame with photo slots */}
                        {(() => {
                            const cw = selectedFrame?.canvas_width || 600;
                            const ch = selectedFrame?.canvas_height || 1050;
                            const maxH = 380;
                            const scale = maxH / ch;
                            const pw = Math.round(cw * scale);
                            const ph = maxH;
                            return (
                                <div className="relative overflow-hidden" style={{ width: `${pw}px`, height: `${ph}px` }}>
                                    {/* Photo slots - layer below or default */}
                                    {selectedFrame?.photo_slots?.filter(slot => slot.layer !== 'above').map((slot, index) => {
                                        const originalIndex = selectedFrame.photo_slots!.indexOf(slot);
                                        return (
                                            <div
                                                key={slot.id}
                                                className="absolute overflow-hidden z-0"
                                                style={{
                                                    left: `${(slot.x / 1000) * 100}%`,
                                                    top: `${(slot.y / 1000) * 100}%`,
                                                    width: `${(slot.width / 1000) * 100}%`,
                                                    height: `${(slot.height / 1000) * 100}%`,
                                                    transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                                }}
                                            >
                                                {capturedPhotos[originalIndex] ? (
                                                    <img
                                                        src={capturedPhotos[originalIndex].dataUrl}
                                                        alt={`Photo ${originalIndex + 1}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : originalIndex === currentPhotoIndex && lastCapturedPhoto ? (
                                                    <img
                                                        src={lastCapturedPhoto}
                                                        alt="Preview"
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : originalIndex === currentPhotoIndex ? (
                                                    <motion.div
                                                        className="w-full h-full bg-primary/10 flex items-center justify-center"
                                                        animate={{ opacity: [0.5, 0.8, 0.5] }}
                                                        transition={{ repeat: Infinity, duration: 1.5 }}
                                                    >
                                                        <CameraIcon className="w-5 h-5 text-primary" strokeWidth={1.5} />
                                                    </motion.div>
                                                ) : (
                                                    <div className="w-full h-full bg-muted flex items-center justify-center">
                                                        <span className="text-muted-foreground text-xs">{originalIndex + 1}</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* Frame overlay */}
                                    {selectedFrame && (
                                        <img
                                            src={selectedFrame.image_url}
                                            alt="Frame"
                                            className="absolute inset-0 w-full h-full object-contain z-10 pointer-events-none"
                                        />
                                    )}

                                    {/* Photo slots - layer above */}
                                    {selectedFrame?.photo_slots?.filter(slot => slot.layer === 'above').map((slot) => {
                                        const originalIndex = selectedFrame.photo_slots!.indexOf(slot);
                                        return (
                                            <div
                                                key={slot.id}
                                                className="absolute overflow-hidden z-20"
                                                style={{
                                                    left: `${(slot.x / 1000) * 100}%`,
                                                    top: `${(slot.y / 1000) * 100}%`,
                                                    width: `${(slot.width / 1000) * 100}%`,
                                                    height: `${(slot.height / 1000) * 100}%`,
                                                    transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                                }}
                                            >
                                                {capturedPhotos[originalIndex] ? (
                                                    <img
                                                        src={capturedPhotos[originalIndex].dataUrl}
                                                        alt={`Photo ${originalIndex + 1}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : originalIndex === currentPhotoIndex && lastCapturedPhoto ? (
                                                    <img
                                                        src={lastCapturedPhoto}
                                                        alt="Preview"
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : originalIndex === currentPhotoIndex ? (
                                                    <motion.div
                                                        className="w-full h-full bg-primary/10 flex items-center justify-center"
                                                        animate={{ opacity: [0.5, 0.8, 0.5] }}
                                                        transition={{ repeat: Infinity, duration: 1.5 }}
                                                    >
                                                        <CameraIcon className="w-5 h-5 text-primary" strokeWidth={1.5} />
                                                    </motion.div>
                                                ) : (
                                                    <div className="w-full h-full bg-muted flex items-center justify-center">
                                                        <span className="text-muted-foreground text-xs">{originalIndex + 1}</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </div>

                    {/* Captured photos thumbnails */}
                    {capturedPhotos.length > 0 && (
                        <div className="flex gap-2 mt-4">
                            {capturedPhotos.map((photo, index) => (
                                <motion.div
                                    key={index}
                                    initial={{ scale: 0, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="w-14 h-14 rounded-lg overflow-hidden border border-border elegant-shadow"
                                >
                                    <img
                                        src={photo.dataUrl}
                                        alt={`Captured ${index + 1}`}
                                        className="w-full h-full object-cover"
                                    />
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
