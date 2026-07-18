import { useState, useCallback, useEffect, useRef } from 'react';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';

export type CapturePhase = 'waiting' | 'countdown' | 'capturing' | 'preview';

export function useCaptureFlow(
    getScreenshot: () => string | null,
    cameraReady: boolean,
    stream?: MediaStream | null,
    getBackendCapture?: () => Promise<string | null>,
    isBackendMode: boolean = false,
) {
    const {
        selectedFrame,
        currentPhotoIndex,
        setCurrentPhotoIndex,
        addCapturedPhoto,
        replaceCapturedPhoto,
        capturedPhotos,
        pendingRetakeIndex,
        setPendingRetakeIndex,
        retakeReturnStep,
        setRetakeReturnStep,
        setStep,
    } = useBoothStore();

    const { isVideoMode } = useAdminStore();
    const { booth } = useTenantStore();
    const activeSession = useSessionProfileStore((s) => s.activeSession);

    // Session settings take priority over booth settings
    const countdownSec = activeSession?.countdown_seconds ?? booth?.countdown_seconds ?? 3;
    const previewSec = activeSession?.preview_seconds ?? booth?.preview_seconds ?? 5;
    const filterEnabled = activeSession?.filter_enabled ?? booth?.filter_enabled ?? true;
    const nextStepAfterCapture = filterEnabled ? 'filter' : 'final-review';

    const [flashActive, setFlashActive] = useState(false);
    const [phase, setPhase] = useState<CapturePhase>('waiting');
    const [countdown, setCountdown] = useState(countdownSec);
    const [previewCountdown, setPreviewCountdown] = useState(previewSec);
    const [lastCapturedPhoto, setLastCapturedPhoto] = useState<string | null>(null);
    const [lastCapturedVideo, setLastCapturedVideo] = useState<Blob | null>(null);
    const retakingIndex = pendingRetakeIndex;

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoChunksRef = useRef<Blob[]>([]);

    const totalPhotos = (selectedFrame?.photo_slots?.length || 0) > 0
        ? Math.max(...selectedFrame!.photo_slots.map((s, i) => s.capture_index ?? i)) + 1
        : 3;

    const startCountdown = useCallback(() => {
        if (cameraReady && phase === 'waiting') {
            setPhase('countdown');
            setCountdown(countdownSec);
        }
    }, [cameraReady, phase, countdownSec]);

    const capturePhoto = useCallback(async () => {
        setPhase('capturing');
        setFlashActive(true);

        setTimeout(() => {
            setFlashActive(false);
        }, 150);

        let imageSrc: string | null = null;

        if (isBackendMode && getBackendCapture) {
            // Sony (CrSDK) / Canon (EDSDK): trigger the real shutter release
            imageSrc = await getBackendCapture();
        } else {
            // System webcam: grab frame from the browser video stream
            imageSrc = getScreenshot();
        }

        if (imageSrc) {
            setLastCapturedPhoto(imageSrc);
            setPhase('preview');
            // Keep preview duration, but auto-continue without Keep/Retake dialog.
            setPreviewCountdown(previewSec);
        }
    }, [getScreenshot, getBackendCapture, isBackendMode, previewSec]);

    useEffect(() => {
        if (!cameraReady || phase !== 'countdown') return;

        if (countdown > 0) {
            // Start recording 3 seconds before capture, or handle cases where countdown is precisely 3, 2 or 1
            // Video recording is disabled for backend SDK cameras (still-image only)
            if (isVideoMode && !isBackendMode && stream && countdown === Math.min(3, countdownSec)) {
                try {
                    videoChunksRef.current = [];
                    // Prefer webm since mp4 via MediaRecorder can be very finicky in Safari/WebKit
                    const mr = new MediaRecorder(stream, { mimeType: 'video/webm' });
                    mr.ondataavailable = (e) => {
                        if (e.data.size > 0) videoChunksRef.current.push(e.data);
                    };
                    // Use a small timeslice to improve chunk delivery reliability across browsers.
                    mr.start(250);
                    mediaRecorderRef.current = mr;
                } catch (err) {
                    console.error("Failed to start MediaRecorder", err);
                    try {
                        const mr = new MediaRecorder(stream); // fallback default
                        mr.ondataavailable = (e) => {
                            if (e.data.size > 0) videoChunksRef.current.push(e.data);
                        };
                        mr.start(250);
                        mediaRecorderRef.current = mr;
                    } catch (e2) {
                        console.error("Fallback MediaRecorder failed", e2);
                    }
                }
            }

            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            // Stop recording
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                const mrSettings = mediaRecorderRef.current.mimeType;
                mediaRecorderRef.current.onstop = () => {
                    const blob = new Blob(videoChunksRef.current, { type: mrSettings || 'video/webm' });
                    if (blob.size > 0) {
                        setLastCapturedVideo(blob);
                    } else {
                        console.warn('[CaptureFlow] Recorded video blob is empty; skipping video clip for this shot.');
                        setLastCapturedVideo(null);
                    }
                    mediaRecorderRef.current = null;
                };
                mediaRecorderRef.current.stop();
            }
            capturePhoto();
        }
    }, [cameraReady, countdown, phase, capturePhoto, isVideoMode, isBackendMode, stream, countdownSec]);

    const handleContinue = useCallback(() => {
        if (lastCapturedPhoto && phase === 'preview') {
            const photoData = lastCapturedPhoto;
            const videoData = lastCapturedVideo;

            setLastCapturedPhoto(null);
            setLastCapturedVideo(null);
            setPhase('capturing');

            if (retakingIndex !== null) {
                // Retake mode: replace the specific photo
                replaceCapturedPhoto(retakingIndex, {
                    index: retakingIndex,
                    dataUrl: photoData,
                    videoBlob: videoData || undefined,
                });
                const savedIndex = currentPhotoIndex;
                setPendingRetakeIndex(null);
                const stepAfterRetake = retakeReturnStep ?? nextStepAfterCapture;
                setRetakeReturnStep(null);

                // If all photos are captured, go to filter selection
                if (capturedPhotos.length >= totalPhotos) {
                    setStep(stepAfterRetake);
                } else {
                    // Resume normal flow at next uncaptured slot
                    setCurrentPhotoIndex(savedIndex);
                    setCountdown(countdownSec);
                    setPhase('countdown');
                }
            } else {
                // Normal flow: add the photo
                const photoIndex = currentPhotoIndex;
                addCapturedPhoto({
                    index: photoIndex,
                    dataUrl: photoData,
                    videoBlob: videoData || undefined,
                });

                if (photoIndex + 1 >= totalPhotos) {
                    setStep(nextStepAfterCapture);
                } else {
                    setCurrentPhotoIndex(photoIndex + 1);
                    setCountdown(countdownSec);
                    setPhase('countdown');
                }
            }
        }
    }, [lastCapturedPhoto, lastCapturedVideo, phase, currentPhotoIndex, totalPhotos, addCapturedPhoto, replaceCapturedPhoto, setStep, setCurrentPhotoIndex, countdownSec, retakingIndex, capturedPhotos.length, nextStepAfterCapture, setPendingRetakeIndex, retakeReturnStep, setRetakeReturnStep]);

    // Preview auto-continue timer
    useEffect(() => {
        if (phase !== 'preview') return;

        if (previewCountdown > 0) {
            const timer = setTimeout(() => setPreviewCountdown(previewCountdown - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            handleContinue();
        }
    }, [phase, previewCountdown, handleContinue]);

    const handleRetake = () => {
        setLastCapturedPhoto(null);
        setLastCapturedVideo(null);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current = null;
        }
        setCountdown(countdownSec);
        setPhase('countdown');
    };

    const retakePhoto = (index: number) => {
        setPendingRetakeIndex(index);
        setRetakeReturnStep(null);
        setLastCapturedPhoto(null);
        setLastCapturedVideo(null);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current = null;
        }
        setCountdown(countdownSec);
        setPhase('countdown');
    };

    return {
        phase,
        countdown,
        previewCountdown,
        flashActive,
        lastCapturedPhoto,
        lastCapturedVideo,
        totalPhotos,
        retakingIndex,
        handleRetake,
        handleContinue,
        retakePhoto,
        startCountdown,
    };
}
