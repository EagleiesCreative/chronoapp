'use client';

import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { useBoothStore, useAdminStore } from '@/store/booth-store';

interface CameraContextType {
    webcamRef: React.RefObject<Webcam | null>;
    getScreenshot: () => string | null;
    isCameraReady: boolean;
    cameraError: string | null;
    stream: MediaStream | null;
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
    const { selectedCameraId } = useAdminStore();

    // Camera is active for all steps EXCEPT 'idle' (start screen)
    const shouldBeActive = step !== 'idle';

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

    const getScreenshot = useCallback(() => {
        return webcamRef.current?.getScreenshot() || null;
    }, []);

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
        ...(selectedCameraId
            ? { deviceId: { exact: selectedCameraId } }
            : { facingMode: 'user' as const }),
    };

    return (
        <CameraContext.Provider value={{ webcamRef, getScreenshot, isCameraReady, cameraError, stream }}>
            {children}

            {/* Persistent webcam element - must be rendered and not display:none for screenshots to work */}
            {shouldBeActive && (
                <div className="pointer-events-none fixed -left-[9999px] -top-[9999px] opacity-0 overflow-hidden w-[1920px] h-[1080px]">
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        screenshotQuality={1}
                        mirrored={true}
                        videoConstraints={videoConstraints}
                        onUserMedia={handleUserMedia}
                        onUserMediaError={handleUserMediaError}
                    />
                </div>
            )}
        </CameraContext.Provider>
    );
};
