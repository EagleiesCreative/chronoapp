'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAdminStore } from '@/store/booth-store';
import { invoke } from '@tauri-apps/api/core';


interface CameraDevice {
    id: string; // Changed from deviceId to match backend
    name: string; // Changed from label to match backend
}

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

export function CameraSelector() {
    const [cameras, setCameras] = useState<CameraDevice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isTesting, setIsTesting] = useState(false);
    const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
    const [previewFrame, setPreviewFrame] = useState<string | null>(null);
    const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
        if (node && previewStream) {
            // Only update if it's different to prevent resetting the stream on re-renders
            if (node.srcObject !== previewStream) {
                node.srcObject = previewStream;
            }
        }
    }, [previewStream]);
    const previewIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const isMountedRef = useRef(true);

    // Track mount state for async safety
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (previewIntervalRef.current) {
                clearInterval(previewIntervalRef.current);
            }
        };
    }, []);

    const {
        selectedCameraId,
        setSelectedCameraId,
        browserCameraId,
        setBrowserCameraId,
        cameraTestStatus,
        setCameraTestStatus,
        cameraError,
        setCameraError,
        isCameraMirrored,
        setCameraMirrored,
        isVideoMode,
        setIsVideoMode,
    } = useAdminStore();

    // Check if getUserMedia is available
    const isMediaSupported = typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function';

    // Resolve browser WebAPI deviceId from a Tauri camera name
    const resolveBrowserDeviceId = useCallback(async (cameraName: string): Promise<string | null> => {
        if (!navigator.mediaDevices?.enumerateDevices) return null;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            // Strip " (System)" / " (Canon SDK)" suffixes for matching
            const cleanName = cameraName.replace(/ \(System\)$/, '').replace(/ \(Canon SDK\)$/, '').trim();
            const match = videoDevices.find(d =>
                d.label.toLowerCase().includes(cleanName.toLowerCase()) ||
                cleanName.toLowerCase().includes(d.label.toLowerCase())
            );
            return match?.deviceId ?? null;
        } catch {
            return null;
        }
    }, []);

    // Load available cameras
    const loadCameras = useCallback(async () => {
        setIsLoading(true);
        setCameraError(null);

        if (!isMediaSupported) {
            setCameraError('Camera API is not supported in this environment. Please ensure you are running in a secure context (HTTPS or localhost).');
            setIsLoading(false);
            return;
        }

        try {
            // First request permission via browser if needed (for webcams)
            // But we primarily want to use Tauri's list_cameras
            if (isMediaSupported) {
               try { await navigator.mediaDevices.getUserMedia({ video: true }); } catch(e) {}
            }

            // Call Tauri backend to get unified camera list (System + Canon)
            const videoDevices = await invoke<CameraDevice[]>('list_cameras');

            setCameras(videoDevices);

            if (videoDevices.length > 0) {
                const persistedStillAvailable = selectedCameraId
                    && videoDevices.some((d) => d.id === selectedCameraId);

                if (!persistedStillAvailable) {
                    // Persisted camera gone or no selection — pick first available
                    const first = videoDevices[0];
                    setSelectedCameraId(first.id);
                    // Also resolve the browser deviceId for react-webcam
                    const browserId = await resolveBrowserDeviceId(first.name);
                    setBrowserCameraId(browserId);
                }
                // else: persisted camera is connected, keep it selected
            }
        } catch (error) {

            console.error('Error loading cameras:', error);
            if (error instanceof Error) {
                if (error.name === 'NotAllowedError') {
                    setCameraError('Camera access denied. Please grant camera permission and try again.');
                } else if (error.name === 'NotFoundError') {
                    setCameraError('No camera found. Please connect a camera and try again.');
                } else {
                    setCameraError(`Failed to access camera: ${error.message}`);
                }
            } else {
                setCameraError('An unknown error occurred while accessing the camera.');
            }
        } finally {
            setIsLoading(false);
        }
    }, [isMediaSupported, selectedCameraId, setSelectedCameraId, setBrowserCameraId, setCameraError, resolveBrowserDeviceId]);

    // Load cameras on mount
    useEffect(() => {
        loadCameras();
    }, [loadCameras]);

    // Stop preview stream
    const stopPreview = useCallback(async () => {
        if (previewStream) {
            previewStream.getTracks().forEach(track => track.stop());
            setPreviewStream(null);
        }
        if (previewIntervalRef.current) {
            clearInterval(previewIntervalRef.current);
            previewIntervalRef.current = null;
        }
        setPreviewFrame(null);
        if (isTauri) {
            try { await invoke('stop_camera'); } catch { /* ignore */ }
        }
        setIsTesting(false);
        setCameraTestStatus('idle');
    }, [previewStream, setCameraTestStatus]);

    // Start camera test
    const startTest = async () => {
        if (!selectedCameraId || !isMediaSupported) return;

        setIsTesting(true);
        setCameraTestStatus('testing');
        setCameraError(null);

        try {
            const selectedCamera = cameras.find(c => c.id === selectedCameraId);
            const isCanon = selectedCamera?.name.includes('(Canon SDK)');

            if (isTauri && isCanon) {
                // Start the camera in the backend
                const status = await invoke('start_camera', { device_id: selectedCameraId });
                console.log('Camera started:', status);

                // Poll for preview frames via Tauri command
                let isFetching = false;
                previewIntervalRef.current = setInterval(async () => {
                    if (!isMountedRef.current || isFetching) return;
                    isFetching = true;
                    try {
                        const frame = await invoke<string>('get_preview_frame');
                        if (isMountedRef.current) {
                            setPreviewFrame(frame);
                        }
                    } catch {
                        // Silently ignore frame errors
                    } finally {
                        isFetching = false;
                    }
                }, 100); // ~10 FPS
            } else {
                const deviceIdToUse = browserCameraId || undefined;
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        ...(deviceIdToUse ? { deviceId: { exact: deviceIdToUse } } : {}),
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                    },
                });

                setPreviewStream(stream);
            }
            
            setCameraTestStatus('success');
        } catch (error) {
            console.error('Camera test failed:', error);
            setCameraTestStatus('error');
            if (error instanceof Error) {
                setCameraError(`Camera test failed: ${error.message}`);
            } else {
                setCameraError('Camera test failed with an unknown error.');
            }
            setIsTesting(false);
        }
    };

    // Handle camera selection change
    const handleCameraChange = async (deviceId: string) => {
        // Stop any existing preview
        stopPreview();
        setSelectedCameraId(deviceId);
        // Resolve and save the browser WebAPI deviceId for react-webcam
        const selected = cameras.find(c => c.id === deviceId);
        if (selected) {
            const browserId = await resolveBrowserDeviceId(selected.name);
            setBrowserCameraId(browserId);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (previewStream) {
                previewStream.getTracks().forEach(track => track.stop());
            }
            if (previewIntervalRef.current) {
                clearInterval(previewIntervalRef.current);
            }
        };
    }, [previewStream]);

    return (
        <Card className="glass-card">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Video className="w-5 h-5" />
                    Camera Configuration
                </CardTitle>
                <CardDescription>
                    Select and test your camera before starting a session
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Error/Warning for unsupported environment */}
                {!isMediaSupported && (
                    <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-destructive">Camera API Not Available</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                The camera API is not available in this environment. This may be because:
                            </p>
                            <ul className="text-sm text-muted-foreground list-disc list-inside mt-2 space-y-1">
                                <li>The app is not running in a secure context (HTTPS)</li>
                                <li>Camera permissions are blocked by the system</li>
                                <li>The WebView doesn&apos;t support camera access</li>
                            </ul>
                        </div>
                    </div>
                )}

                {/* Camera selector cards */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Select Camera</label>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={loadCameras}
                            disabled={isLoading}
                            title="Refresh camera list"
                            className="h-8 text-xs"
                        >
                            <RefreshCw className={`w-3 h-3 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                    </div>

                    {isLoading ? (
                        <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                            Loading cameras...
                        </div>
                    ) : !isMediaSupported ? (
                        <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                            Camera API unavailable
                        </div>
                    ) : cameras.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                            No cameras found
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-2">
                            {cameras.map((camera) => (
                                <div
                                    key={camera.id}
                                    onClick={() => handleCameraChange(camera.id)}
                                    className={`relative p-4 rounded-xl border cursor-pointer transition-all ${
                                        selectedCameraId === camera.id 
                                            ? 'border-primary ring-1 ring-primary bg-primary/5' 
                                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2 font-medium">
                                            <Video className="w-4 h-4 text-primary shrink-0" />
                                            <span className="line-clamp-2" title={camera.name}>{camera.name}</span>
                                        </div>
                                    </div>
                                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <div className={`w-1.5 h-1.5 rounded-full ${selectedCameraId === camera.id ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                                        <span>{selectedCameraId === camera.id ? 'Selected' : 'Ready'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Mirror Settings */}
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label className="text-base font-medium">Mirror Camera</Label>
                        <p className="text-sm text-muted-foreground">
                            Flips the camera feed horizontally
                        </p>
                    </div>
                    <Switch
                        checked={isCameraMirrored}
                        onCheckedChange={setCameraMirrored}
                    />
                </div>

                {/* Video Mode Settings */}
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label className="text-base font-medium">Live Video Mode</Label>
                        <p className="text-sm text-muted-foreground">
                            Record 2-second video clips instead of static photos
                        </p>
                    </div>
                    <Switch
                        checked={isVideoMode}
                        onCheckedChange={setIsVideoMode}
                    />
                </div>

                {/* Camera preview */}
                {isTesting && (
                    <div className="relative mx-auto rounded-lg overflow-hidden bg-black max-w-[480px] aspect-video flex-shrink-0">
                        {previewStream ? (
                            <video
                                ref={setVideoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`w-full h-full object-cover transform ${isCameraMirrored ? 'scale-x-[-1]' : ''}`}
                            />
                        ) : previewFrame ? (
                            <img
                                src={`data:image/jpeg;base64,${previewFrame}`}
                                alt="Camera Preview"
                                className={`w-full h-full object-cover transform ${isCameraMirrored ? 'scale-x-[-1]' : ''}`}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                                Starting camera preview...
                            </div>
                        )}
                        {/* Status overlay */}
                        {cameraTestStatus === 'success' && (
                            <div className="absolute top-3 right-3 bg-green-500/90 text-white px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4" />
                                Camera working
                            </div>
                        )}
                    </div>
                )}

                {/* Error display */}
                {cameraError && (
                    <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-destructive">Camera Error</p>
                            <p className="text-sm text-muted-foreground mt-1">{cameraError}</p>
                        </div>
                    </div>
                )}

                {/* Test button */}
                <div className="flex gap-2">
                    {!isTesting ? (
                        <Button
                            onClick={startTest}
                            disabled={!selectedCameraId || isLoading || !isMediaSupported}
                            className="flex-1"
                        >
                            <Video className="w-4 h-4 mr-2" />
                            Test Camera
                        </Button>
                    ) : (
                        <Button
                            onClick={stopPreview}
                            variant="outline"
                            className="flex-1"
                        >
                            <VideoOff className="w-4 h-4 mr-2" />
                            Stop Preview
                        </Button>
                    )}
                </div>

                {/* Info text */}
                <p className="text-sm text-muted-foreground">
                    The selected camera will be used for photo capture during booth sessions.
                    Make sure to test the camera before starting.
                </p>
            </CardContent>
        </Card>
    );
}
