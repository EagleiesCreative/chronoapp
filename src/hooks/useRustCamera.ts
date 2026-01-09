'use client';

import { invoke } from '@tauri-apps/api/core';
import { useState, useCallback, useRef, useEffect } from 'react';

export interface CameraDevice {
    id: string;
    name: string;
}

export interface CameraStatus {
    is_active: boolean;
    device_name: string | null;
    resolution: [number, number] | null;
}

interface UseRustCameraReturn {
    // State
    isActive: boolean;
    isLoading: boolean;
    error: string | null;
    currentFrame: string | null;
    devices: CameraDevice[];
    status: CameraStatus | null;

    // Actions
    listCameras: () => Promise<CameraDevice[]>;
    startCamera: (deviceId?: string) => Promise<void>;
    stopCamera: () => Promise<void>;
    captureFrame: (quality?: number) => Promise<string>;
    getStatus: () => Promise<CameraStatus>;

    // Preview control
    startPreview: (fps?: number) => void;
    stopPreview: () => void;
}

/**
 * Hook to interface with Rust camera backend via Tauri commands.
 * Provides persistent camera session management.
 */
export function useRustCamera(): UseRustCameraReturn {
    const [isActive, setIsActive] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentFrame, setCurrentFrame] = useState<string | null>(null);
    const [devices, setDevices] = useState<CameraDevice[]>([]);
    const [status, setStatus] = useState<CameraStatus | null>(null);

    const previewIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const isMountedRef = useRef(true);

    // Cleanup on unmount
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (previewIntervalRef.current) {
                clearInterval(previewIntervalRef.current);
            }
        };
    }, []);

    /**
     * List all available cameras
     */
    const listCameras = useCallback(async (): Promise<CameraDevice[]> => {
        try {
            setError(null);
            const cameraList = await invoke<CameraDevice[]>('list_cameras');
            if (isMountedRef.current) {
                setDevices(cameraList);
            }
            return cameraList;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isMountedRef.current) {
                setError(message);
            }
            throw new Error(message);
        }
    }, []);

    /**
     * Start camera with optional device ID
     */
    const startCamera = useCallback(async (deviceId?: string): Promise<void> => {
        try {
            setIsLoading(true);
            setError(null);

            const cameraStatus = await invoke<CameraStatus>('start_camera', {
                deviceId: deviceId || null
            });

            if (isMountedRef.current) {
                setStatus(cameraStatus);
                setIsActive(true);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isMountedRef.current) {
                setError(message);
                setIsActive(false);
            }
            throw new Error(message);
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    /**
     * Stop the camera
     */
    const stopCamera = useCallback(async (): Promise<void> => {
        try {
            // Stop preview first
            if (previewIntervalRef.current) {
                clearInterval(previewIntervalRef.current);
                previewIntervalRef.current = null;
            }

            await invoke('stop_camera');

            if (isMountedRef.current) {
                setIsActive(false);
                setStatus(null);
                setCurrentFrame(null);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isMountedRef.current) {
                setError(message);
            }
            throw new Error(message);
        }
    }, []);

    /**
     * Capture a single frame at specified quality (1-100)
     */
    const captureFrame = useCallback(async (quality: number = 90): Promise<string> => {
        try {
            setError(null);
            const frame = await invoke<string>('capture_frame', { quality });
            return frame;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isMountedRef.current) {
                setError(message);
            }
            throw new Error(message);
        }
    }, []);

    /**
     * Get current camera status
     */
    const getStatus = useCallback(async (): Promise<CameraStatus> => {
        try {
            const cameraStatus = await invoke<CameraStatus>('get_camera_status');
            if (isMountedRef.current) {
                setStatus(cameraStatus);
                setIsActive(cameraStatus.is_active);
            }
            return cameraStatus;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isMountedRef.current) {
                setError(message);
            }
            throw new Error(message);
        }
    }, []);

    /**
     * Start live preview with specified FPS (default 10)
     */
    const startPreview = useCallback((fps: number = 10) => {
        // Stop any existing preview
        if (previewIntervalRef.current) {
            clearInterval(previewIntervalRef.current);
        }

        const intervalMs = Math.round(1000 / fps);
        let isFetching = false;

        previewIntervalRef.current = setInterval(async () => {
            if (!isMountedRef.current || isFetching) return;

            isFetching = true;
            try {
                const frame = await invoke<string>('get_preview_frame');
                if (isMountedRef.current) {
                    setCurrentFrame(frame);
                }
            } catch {
                // Silently ignore preview frame errors
            } finally {
                isFetching = false;
            }
        }, intervalMs);
    }, []);

    /**
     * Stop live preview
     */
    const stopPreview = useCallback(() => {
        if (previewIntervalRef.current) {
            clearInterval(previewIntervalRef.current);
            previewIntervalRef.current = null;
        }
        setCurrentFrame(null);
    }, []);

    return {
        isActive,
        isLoading,
        error,
        currentFrame,
        devices,
        status,
        listCameras,
        startCamera,
        stopCamera,
        captureFrame,
        getStatus,
        startPreview,
        stopPreview,
    };
}
