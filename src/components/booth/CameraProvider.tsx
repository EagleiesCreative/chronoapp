'use client';

import React, { createContext, useContext, useRef, useState, useCallback, useEffect, useMemo } from 'react';
import Webcam from 'react-webcam';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { invoke } from '@tauri-apps/api/core';

interface CameraContextType {
    webcamRef: React.RefObject<Webcam | null>;
    getScreenshot: () => string | null;
    /** Full-res shutter capture via the Rust backend (Sony CrSDK or Canon EDSDK). */
    getBackendCapture: () => Promise<string | null>;
    isCameraReady: boolean;
    cameraError: string | null;
    stream: MediaStream | null;
    /** True when the active camera is a backend SDK camera (Sony or Canon). */
    isBackendMode: boolean;
}

const CameraContext = createContext<CameraContextType | null>(null);

export const useCamera = () => {
    const context = useContext(CameraContext);
    if (!context) {
        throw new Error('useCamera must be used within a CameraProvider');
    }
    return context;
};

export const CameraProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const webcamRef = useRef<Webcam>(null);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const { step } = useBoothStore();
    const { browserCameraId, isCameraMirrored, cameraType, selectedCameraId, isLiveViewCapture, isVideoMode } = useAdminStore();

    const isSonyMode = cameraType === 'sony';
    const isCanonMode = cameraType === 'canon';
    // Both Sony (CrSDK) and Canon (EDSDK) are driven by the Rust backend:
    // live view via the MJPEG stream server, capture via a backend command.
    const isBackendMode = isSonyMode || isCanonMode;

    // Keep camera warm on all booth steps, including idle, so users can preview before starting.
    const shouldBeActive = true;

    const handleUserMedia = useCallback((mediaStream: MediaStream) => {
        console.log('Standby Camera Ready');
        setStream(mediaStream);
        setIsCameraReady(true);
        setCameraError(null);
    }, []);

    const handleUserMediaError = useCallback((error: string | DOMException) => {
        console.error('Standby Camera Error:', error);
        setCameraError(typeof error === 'string' ? error : (error as any).message || 'Camera error');
        setIsCameraReady(false);
        setStream(null);
    }, []);

    // Standard webcam screenshot (for system cameras)
    const getScreenshot = useCallback(() => {
        return webcamRef.current?.getScreenshot() || null;
    }, []);

    // Backend direct capture — triggers actual shutter release via the native SDK.
    const getBackendCapture = useCallback(async (): Promise<string | null> => {
        if (!isBackendMode) return null;
        // Live-view capture: grab the current live-view frame, no shutter, live view keeps running.
        const command = isLiveViewCapture
            ? 'capture_frame'
            : isCanonMode ? 'canon_capture_image' : 'sony_capture_image';
        try {
            const frame = await invoke<string>(command, { quality: 95 });
            if (typeof frame !== 'string' || !frame.startsWith('data:image/') || frame.length < 128) {
                throw new Error('Backend returned empty or invalid image data');
            }
            setCameraError(null);
            return frame; // base64 data URL of full-res JPEG
        } catch (err) {
            console.error('Backend capture failed:', err);
            setCameraError(`Capture error: ${err}`);
            return null;
        }
    }, [isBackendMode, isCanonMode, isLiveViewCapture]);

    // Backend + live-view capture + Live Video Mode: build a MediaStream from the MJPEG live
    // view (hidden <img> -> <canvas> -> captureStream) so useCaptureFlow can record clips with
    // MediaRecorder exactly like it does for a webcam.
    useEffect(() => {
        if (!isBackendMode || !isLiveViewCapture || !isVideoMode || !isCameraReady) return;

        const FPS = 25;
        const img = new Image();
        img.crossOrigin = 'anonymous'; // stream server sends CORS headers → canvas stays untainted
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let canvasStream: MediaStream | null = null;
        let timer: ReturnType<typeof setInterval> | null = null;
        let cancelled = false;

        img.onload = () => {
            if (cancelled || !ctx || canvasStream) return;
            canvas.width = img.naturalWidth || 1024;
            canvas.height = img.naturalHeight || 680;
            timer = setInterval(() => {
                try {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                } catch {
                    /* frame not decodable yet */
                }
            }, 1000 / FPS);
            canvasStream = canvas.captureStream(FPS);
            setStream(canvasStream);
            console.log(`[CameraProvider] Live-view MediaStream ready (${canvas.width}x${canvas.height} @ ${FPS}fps)`);
        };
        img.onerror = () => console.warn('[CameraProvider] Live-view stream for video recording failed to load');
        img.src = `http://localhost:3030/stream?rec=${Date.now()}`;

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            canvasStream?.getTracks().forEach((t) => t.stop());
            img.onload = null;
            img.src = ''; // closes the MJPEG connection
            setStream((current) => (current === canvasStream ? null : current));
        };
    }, [isBackendMode, isLiveViewCapture, isVideoMode, isCameraReady]);

    const isBackendDeviceId = Boolean(
        selectedCameraId &&
        (selectedCameraId.startsWith('sony_') ||
            selectedCameraId.startsWith('canon_') ||
            selectedCameraId.startsWith('gphoto2_'))
    );

    // Backend camera (Sony/Canon): start/stop the native session
    useEffect(() => {
        if (!isBackendMode || !shouldBeActive || !selectedCameraId) return;

        const label = isCanonMode ? 'Canon' : 'Sony';

        if (!isBackendDeviceId) {
            setCameraError(`No ${label} camera selected (${selectedCameraId}). Select your ${label} camera in Admin → Config.`);
            setIsCameraReady(false);
            return;
        }

        let mounted = true;
        let didStart = false;

        // Small debounce prevents React StrictMode double-mount from queuing
        // overlapping start_camera + stop_camera + start_camera calls.
        const timer = setTimeout(async () => {
            if (!mounted) return;
            didStart = true;
            try {
                const status = await invoke('start_camera', { deviceId: selectedCameraId });
                if (mounted) {
                    console.log(`${label} camera started:`, status);
                    setIsCameraReady(true);
                    setCameraError(null);
                }
            } catch (err) {
                if (mounted) {
                    console.error(`${label} camera start error:`, err);
                    setCameraError(`${label} camera error: ${err}`);
                    setIsCameraReady(false);
                }
            }
        }, 100);

        return () => {
            mounted = false;
            clearTimeout(timer);
            if (didStart) {
                invoke('stop_camera').catch(() => {});
            }
            setIsCameraReady(false);
        };
    }, [isBackendMode, isCanonMode, isBackendDeviceId, shouldBeActive, selectedCameraId]);

    // Re-verify backend camera session when entering idle or countdown
    useEffect(() => {
        if (!isBackendMode || !isBackendDeviceId || !selectedCameraId) return;
        if (step !== 'idle' && step !== 'countdown') return;

        let cancelled = false;
        const label = isCanonMode ? 'Canon' : 'Sony';
        const timer = setTimeout(() => {
            invoke('start_camera', { deviceId: selectedCameraId })
                .then(() => {
                    if (!cancelled) {
                        setIsCameraReady(true);
                        setCameraError(null);
                    }
                })
                .catch((err) => {
                    if (!cancelled) {
                        console.error(`${label} camera re-verify error:`, err);
                        setCameraError(`${label} camera error: ${err}`);
                        setIsCameraReady(false);
                    }
                });
        }, 50);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [step, isBackendMode, isCanonMode, isBackendDeviceId, selectedCameraId]);

    // Reset readiness when camera should be inactive
    useEffect(() => {
        if (!shouldBeActive) {
            setIsCameraReady(false);
            setStream(null);
        }
    }, [shouldBeActive]);

    const videoConstraints = useMemo(() => ({
        width: 1920,
        height: 1080,
        ...(browserCameraId
            ? { deviceId: { exact: browserCameraId } }
            : { facingMode: 'user' as const }),
    }), [browserCameraId]);

    return (
        <CameraContext.Provider value={{ webcamRef, getScreenshot, getBackendCapture, isCameraReady, cameraError, stream, isBackendMode }}>
            {children}

            {/* Persistent webcam element — only for system cameras (not Sony/Canon, which stream from the backend) */}
            {shouldBeActive && !isBackendMode && (
                <div className="pointer-events-none fixed -left-[9999px] -top-[9999px] opacity-0 overflow-hidden w-[1920px] h-[1080px]">
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        screenshotQuality={1}
                        mirrored={isCameraMirrored}
                        videoConstraints={videoConstraints}
                        onUserMedia={handleUserMedia}
                        onUserMediaError={handleUserMediaError}
                    />
                </div>
            )}
        </CameraContext.Provider>
    );
};

