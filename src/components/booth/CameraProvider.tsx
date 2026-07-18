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
    const { browserCameraId, isCameraMirrored, cameraType, selectedCameraId } = useAdminStore();

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
        const command = isCanonMode ? 'canon_capture_image' : 'sony_capture_image';
        try {
            const frame = await invoke<string>(command, { quality: 95 });
            return frame; // base64 data URL of full-res JPEG
        } catch (err) {
            console.error('Backend capture failed:', err);
            setCameraError(`Capture error: ${err}`);
            return null;
        }
    }, [isBackendMode, isCanonMode]);

    // Backend camera (Sony/Canon): start/stop the native session
    useEffect(() => {
        if (!isBackendMode || !shouldBeActive || !selectedCameraId) return;

        let mounted = true;
        const label = isCanonMode ? 'Canon' : 'Sony';

        (async () => {
            try {
                const status = await invoke('start_camera', { device_id: selectedCameraId });
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
        })();

        return () => {
            mounted = false;
            invoke('stop_camera').catch(() => {});
            setIsCameraReady(false);
        };
    }, [isBackendMode, isCanonMode, shouldBeActive, selectedCameraId]);

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

