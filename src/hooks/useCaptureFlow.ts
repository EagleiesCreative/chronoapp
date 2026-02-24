import { useState, useCallback, useEffect } from 'react';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';

export type CapturePhase = 'countdown' | 'capturing' | 'preview';

export function useCaptureFlow(getScreenshot: () => string | null, cameraReady: boolean) {
    const {
        selectedFrame,
        currentPhotoIndex,
        setCurrentPhotoIndex,
        addCapturedPhoto,
        replaceCapturedPhoto,
        capturedPhotos,
        setStep,
    } = useBoothStore();

    const { booth } = useTenantStore();
    const activeSession = useSessionProfileStore((s) => s.activeSession);

    // Session settings take priority over booth settings
    const countdownSec = activeSession?.countdown_seconds ?? booth?.countdown_seconds ?? 3;
    const previewSec = activeSession?.preview_seconds ?? booth?.preview_seconds ?? 5;

    const [flashActive, setFlashActive] = useState(false);
    const [phase, setPhase] = useState<CapturePhase>('countdown');
    const [countdown, setCountdown] = useState(countdownSec);
    const [previewCountdown, setPreviewCountdown] = useState(previewSec);
    const [lastCapturedPhoto, setLastCapturedPhoto] = useState<string | null>(null);
    const [retakingIndex, setRetakingIndex] = useState<number | null>(null);

    const totalPhotos = selectedFrame?.photo_slots?.length || 3;

    const capturePhoto = useCallback(() => {
        setPhase('capturing');
        setFlashActive(true);

        setTimeout(() => {
            setFlashActive(false);
        }, 150);

        const imageSrc = getScreenshot();

        if (imageSrc) {
            setLastCapturedPhoto(imageSrc);
            setPhase('preview');
            setPreviewCountdown(previewSec);
        }
    }, [getScreenshot, previewSec]);

    useEffect(() => {
        if (!cameraReady || phase !== 'countdown') return;

        if (countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            capturePhoto();
        }
    }, [cameraReady, countdown, phase, capturePhoto]);

    const handleContinue = useCallback(() => {
        if (lastCapturedPhoto && phase === 'preview') {
            const photoData = lastCapturedPhoto;

            setLastCapturedPhoto(null);
            setPhase('capturing');

            if (retakingIndex !== null) {
                // Retake mode: replace the specific photo
                replaceCapturedPhoto(retakingIndex, {
                    index: retakingIndex,
                    dataUrl: photoData,
                });
                const savedIndex = currentPhotoIndex;
                setRetakingIndex(null);

                // If all photos are captured, go to filter selection
                if (capturedPhotos.length >= totalPhotos) {
                    setStep('filter');
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
                });

                if (photoIndex + 1 >= totalPhotos) {
                    setStep('filter');
                } else {
                    setCurrentPhotoIndex(photoIndex + 1);
                    setCountdown(countdownSec);
                    setPhase('countdown');
                }
            }
        }
    }, [lastCapturedPhoto, phase, currentPhotoIndex, totalPhotos, addCapturedPhoto, replaceCapturedPhoto, setStep, setCurrentPhotoIndex, countdownSec, retakingIndex, capturedPhotos.length]);

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
        setCountdown(countdownSec);
        setPhase('countdown');
    };

    const retakePhoto = (index: number) => {
        setRetakingIndex(index);
        setLastCapturedPhoto(null);
        setCountdown(countdownSec);
        setPhase('countdown');
    };

    return {
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
    };
}
