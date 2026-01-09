'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdminStore } from '@/store/booth-store';

interface CameraDevice {
    deviceId: string;
    label: string;
}

export function CameraSelector() {
    const [cameras, setCameras] = useState<CameraDevice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isTesting, setIsTesting] = useState(false);
    const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    const {
        selectedCameraId,
        setSelectedCameraId,
        cameraTestStatus,
        setCameraTestStatus,
        cameraError,
        setCameraError,
    } = useAdminStore();

    // Check if getUserMedia is available
    const isMediaSupported = typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function';

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
            // First request permission to access media devices
            await navigator.mediaDevices.getUserMedia({ video: true });

            // Then enumerate devices
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices
                .filter(device => device.kind === 'videoinput')
                .map((device, index) => ({
                    deviceId: device.deviceId,
                    label: device.label || `Camera ${index + 1}`,
                }));

            setCameras(videoDevices);

            // Auto-select first camera if none selected
            if (!selectedCameraId && videoDevices.length > 0) {
                setSelectedCameraId(videoDevices[0].deviceId);
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
    }, [isMediaSupported, selectedCameraId, setSelectedCameraId, setCameraError]);

    // Load cameras on mount
    useEffect(() => {
        loadCameras();
    }, [loadCameras]);

    // Stop preview stream
    const stopPreview = useCallback(() => {
        if (previewStream) {
            previewStream.getTracks().forEach(track => track.stop());
            setPreviewStream(null);
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
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: { exact: selectedCameraId },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
            });

            setPreviewStream(stream);

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
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
    const handleCameraChange = (deviceId: string) => {
        // Stop any existing preview
        stopPreview();
        setSelectedCameraId(deviceId);
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (previewStream) {
                previewStream.getTracks().forEach(track => track.stop());
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

                {/* Camera selector dropdown */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">Select Camera</label>
                    <div className="flex gap-2">
                        <Select
                            value={selectedCameraId || ''}
                            onValueChange={handleCameraChange}
                            disabled={isLoading || cameras.length === 0}
                        >
                            <SelectTrigger className="flex-1">
                                <SelectValue placeholder={isLoading ? "Loading cameras..." : "Select a camera"} />
                            </SelectTrigger>
                            <SelectContent>
                                {cameras.map((camera) => (
                                    <SelectItem key={camera.deviceId} value={camera.deviceId}>
                                        {camera.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={loadCameras}
                            disabled={isLoading}
                            title="Refresh camera list"
                        >
                            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>

                {/* Camera preview */}
                {isTesting && (
                    <div className="relative rounded-lg overflow-hidden bg-muted aspect-video">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                        />
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
