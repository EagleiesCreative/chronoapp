'use client';

import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { invoke } from '@tauri-apps/api/core';

interface CameraContextType {
    webcamRef: React.RefObject<Webcam | null>;
    getScreenshot: () => string | null;
    getSonyCapture: () => Promise<string | null>;
    isCameraReady: boolean;
    cameraError: string | null;
    stream: MediaStream | null;
    isSonyMode: boolean;
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

    // Sony direct capture — triggers actual shutter release via CrSDK
    const getSonyCapture = useCallback(async (): Promise<string | null> => {
        if (!isSonyMode) return null;
        try {
            const frame = await invoke<string>('sony_capture_image', { quality: 95 });
            return frame; // base64 data URL of full-res JPEG
        } catch (err) {
            console.error('Sony capture failed:', err);
            setCameraError(`Sony capture error: ${err}`);
            return null;
        }
    }, [isSonyMode]);

    // Sony camera: start/stop backend camera session
    useEffect(() => {
        if (!isSonyMode || !shouldBeActive || !selectedCameraId) return;

        let mounted = true;

        (async () => {
            try {
                const status = await invoke('start_camera', { device_id: selectedCameraId });
                if (mounted) {
                    console.log('Sony camera started:', status);
                    setIsCameraReady(true);
                    setCameraError(null);
                }
            } catch (err) {
                if (mounted) {
                    console.error('Sony camera start error:', err);
                    setCameraError(`Sony camera error: ${err}`);
                    setIsCameraReady(false);
                }
            }
        })();

        return () => {
            mounted = false;
            invoke('stop_camera').catch(() => {});
            setIsCameraReady(false);
        };
    }, [isSonyMode, shouldBeActive, selectedCameraId]);

    // Reset readiness when camera should be inactive
    useEffect(() => {
        if (!shouldBeActive) {
            setIsCameraReady(false);
            setStream(null);
        }
    }, [shouldBeActive]);

    const videoConstraints = {
        width: 1920,
        height: 1080,
        ...(browserCameraId
            ? { deviceId: { exact: browserCameraId } }
            : { facingMode: 'user' as const }),
    };

    return (
        <CameraContext.Provider value={{ webcamRef, getScreenshot, getSonyCapture, isCameraReady, cameraError, stream, isSonyMode }}>
            {children}

            {/* Persistent webcam element — only needed for system cameras (not Sony) */}
            {shouldBeActive && !isSonyMode && (
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

