'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Printer, RotateCcw, CheckCircle, Loader2, XCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { apiFetch, getAssetUrl } from '@/lib/api';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { usePrintStore } from '@/store/print-store';
import { generateCompressedGif } from '@/lib/video-generator';
import { uploadFinalImageClient, uploadPhotoClient, uploadGifClient } from '@/lib/upload-client';
import { saveToLocalDisk } from '@/lib/local-save';
import { useLocalSaveStore } from '@/store/local-save-store';
import { getCachedImageUrl } from '@/lib/frame-cache';

export function ReviewScreen() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [compositeImage, setCompositeImage] = useState<string | null>(null);
    const [downloadQR, setDownloadQR] = useState<string | null>(null);
    const [isCompositing, setIsCompositing] = useState(true);
    const [isPrinting, setIsPrinting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<string>('');
    const [videoGenerated, setVideoGenerated] = useState(false);
    const [gifDownloadUrl, setGifDownloadUrl] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const {
        selectedFrame,
        capturedPhotos,
        session,
        setFinalImage,
        setStep,
        resetSession,
    } = useBoothStore();

    const { addJob } = usePrintStore();
    const { booth } = useTenantStore();
    const timeoutSeconds = booth?.review_timeout_seconds ?? 60;
    const printCopiesCount = booth?.print_copies ?? 1;
    const [autoResetCountdown, setAutoResetCountdown] = useState(timeoutSeconds);

    // Auto-reset timer - countdown every second
    useEffect(() => {
        if (isCompositing || isPrinting) return; // Don't count down while busy
        if (autoResetCountdown <= 0) return; // Already at 0

        const timer = setInterval(() => {
            setAutoResetCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(timer);
    }, [isCompositing, isPrinting, autoResetCountdown]);

    // Navigate to idle when countdown reaches 0
    useEffect(() => {
        if (autoResetCountdown === 0 && !isCompositing && !isPrinting) {
            resetSession();
            setStep('idle');
        }
    }, [autoResetCountdown, isCompositing, isPrinting, resetSession, setStep]);

    // Reset countdown on user interaction
    const resetCountdown = () => {
        setAutoResetCountdown(timeoutSeconds);
    };


    // Composite the images
    useEffect(() => {
        async function compositeImages() {
            if (!selectedFrame || capturedPhotos.length === 0 || !canvasRef.current) return;

            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const canvasWidth = selectedFrame.canvas_width || 600;
            const canvasHeight = selectedFrame.canvas_height || 1050;

            canvas.width = canvasWidth;
            canvas.height = canvasHeight;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Helper function to draw a photo in its slot
            const drawPhotoInSlot = async (photoIndex: number) => {
                const photo = capturedPhotos[photoIndex];
                const slot = selectedFrame.photo_slots?.[photoIndex];

                if (!slot || !photo?.dataUrl) return;

                const img = new Image();
                await new Promise<void>((resolve) => {
                    img.onload = () => {
                        const destX = (slot.x / 1000) * canvas.width;
                        const destY = (slot.y / 1000) * canvas.height;
                        const destW = (slot.width / 1000) * canvas.width;
                        const destH = (slot.height / 1000) * canvas.height;

                        const imgAspect = img.naturalWidth / img.naturalHeight;
                        const slotAspect = destW / destH;

                        let srcX = 0;
                        let srcY = 0;
                        let srcW = img.naturalWidth;
                        let srcH = img.naturalHeight;

                        if (imgAspect > slotAspect) {
                            srcW = img.naturalHeight * slotAspect;
                            srcX = (img.naturalWidth - srcW) / 2;
                        } else {
                            srcH = img.naturalWidth / slotAspect;
                            srcY = (img.naturalHeight - srcH) / 2;
                        }

                        ctx.save();

                        if (slot.rotation) {
                            ctx.translate(destX + destW / 2, destY + destH / 2);
                            ctx.rotate((slot.rotation * Math.PI) / 180);
                            ctx.translate(-(destX + destW / 2), -(destY + destH / 2));
                        }

                        ctx.drawImage(
                            img,
                            srcX, srcY, srcW, srcH,
                            destX, destY, destW, destH
                        );
                        ctx.restore();
                        resolve();
                    };
                    img.src = photo.dataUrl;
                });
            };

            // Draw photos with layer='below' or no layer (default: below)
            for (let i = 0; i < capturedPhotos.length; i++) {
                const slot = selectedFrame.photo_slots?.[i];
                if (!slot || slot.layer === 'above') continue;
                await drawPhotoInSlot(i);
            }

            // Draw frame overlay
            if (selectedFrame.image_url) {
                const frameImg = new Image();
                frameImg.crossOrigin = 'anonymous';
                await new Promise<void>(async (resolve) => {
                    const cachedUrl = await getCachedImageUrl(selectedFrame.image_url);
                    frameImg.onload = () => {
                        ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
                        resolve();
                    };
                    frameImg.onerror = () => resolve();
                    frameImg.src = cachedUrl || getAssetUrl(selectedFrame.image_url);
                });
            }

            // Draw photos with layer='above'
            for (let i = 0; i < capturedPhotos.length; i++) {
                const slot = selectedFrame.photo_slots?.[i];
                if (!slot || slot.layer !== 'above') continue;
                await drawPhotoInSlot(i);
            }

            const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
            setCompositeImage(imageDataUrl);
            setFinalImage(imageDataUrl);
            setIsCompositing(false);

            uploadAndGenerateQR(imageDataUrl);
        }

        compositeImages();
    }, [selectedFrame, capturedPhotos, setFinalImage]);

    async function uploadAndGenerateQR(imageDataUrl: string) {
        setIsUploading(true);
        setUploadError(null);
        try {
            if (!session?.id) {
                throw new Error('No active session found');
            }

            const sessionId = session.id;

            // --- LOCAL SAVE (parallel, non-blocking) ---
            const { enabled: localSaveEnabled, savePath } = useLocalSaveStore.getState();
            let localSessionFolder: string | null = null;

            if (localSaveEnabled && savePath) {
                const now = new Date();
                localSessionFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

                // Save composite strip locally (fire-and-forget)
                saveToLocalDisk(savePath, localSessionFolder, 'strip.jpg', imageDataUrl)
                    .then(p => p && console.log('[LocalSave] Strip saved:', p))
                    .catch(err => console.error('[LocalSave] Strip save failed:', err));

                // Save individual photos locally (fire-and-forget)
                capturedPhotos.forEach((photo, i) => {
                    if (photo.dataUrl && localSessionFolder) {
                        saveToLocalDisk(savePath, localSessionFolder, `photo_${i + 1}.jpg`, photo.dataUrl)
                            .catch(err => console.error(`[LocalSave] Photo ${i + 1} failed:`, err));
                    }
                });
            }
            // --- END LOCAL SAVE ---

            // 1. Upload composite strip image (critical - must succeed)
            setUploadStatus('Uploading photo strip...');
            const stripResponse = await fetch(imageDataUrl);
            const stripBlob = await stripResponse.blob();

            let finalUrl: string;
            try {
                finalUrl = await uploadFinalImageClient(sessionId, stripBlob);
            } catch (err) {
                throw new Error('Failed to upload photo strip: ' + (err instanceof Error ? err.message : 'Unknown error'));
            }

            // 2. Upload individual photos (non-critical - continue on failure)
            const photoUrls: string[] = [];
            const photoDataUrls: string[] = [];

            for (let i = 0; i < capturedPhotos.length; i++) {
                const photo = capturedPhotos[i];
                if (photo.dataUrl) {
                    setUploadStatus(`Uploading photo ${i + 1}/${capturedPhotos.length}...`);
                    photoDataUrls.push(photo.dataUrl);
                    try {
                        const photoResponse = await fetch(photo.dataUrl);
                        const photoBlob = await photoResponse.blob();
                        const photoUrl = await uploadPhotoClient(sessionId, i, photoBlob);
                        photoUrls.push(photoUrl);
                    } catch (photoErr) {
                        console.error(`Failed to upload photo ${i + 1}:`, photoErr);
                    }
                }
            }

            // 3. Generate and upload stop-motion GIF (non-critical)
            let gifUrl: string | null = null;
            if (photoDataUrls.length >= 2) {
                setUploadStatus('Creating stop-motion GIF...');
                try {
                    const gifResult = await generateCompressedGif(photoDataUrls, 1000);
                    if (gifResult) {
                        setUploadStatus('Uploading GIF...');
                        gifUrl = await uploadGifClient(sessionId, gifResult.blob);
                        setVideoGenerated(true);
                        setGifDownloadUrl(gifUrl);
                        console.log(`GIF uploaded: ${(gifResult.size / 1024).toFixed(1)}KB`);

                        // Save GIF locally (fire-and-forget)
                        if (localSaveEnabled && savePath && localSessionFolder) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                const gifDataUrl = reader.result as string;
                                saveToLocalDisk(savePath, localSessionFolder!, 'stopmotion.gif', gifDataUrl)
                                    .then(p => p && console.log('[LocalSave] GIF saved:', p))
                                    .catch(err => console.error('[LocalSave] GIF save failed:', err));
                            };
                            reader.readAsDataURL(gifResult.blob);
                        }
                    }
                } catch (gifErr) {
                    console.error('GIF generation/upload failed:', gifErr);
                }
            }

            // 4. Update session with results (mark as completed)
            setUploadStatus(`Saving ${photoUrls.length} photos and ${gifUrl ? '1 gif' : '0 gif'}...`);
            const completionPayload = {
                sessionId,
                finalImageUrl: finalUrl,
                photosUrls: photoUrls,
                videoUrl: gifUrl,
            };

            const completionResponse = await apiFetch('/api/session/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(completionPayload),
            });

            if (!completionResponse.ok) {
                const errorData = await completionResponse.json();
                throw new Error(errorData.error || `Failed to save session data (${completionResponse.status})`);
            }

            // 5. Generate QR for share page
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://chronosnap.eagleies.com';
            const shareUrl = `${baseUrl}/share/${sessionId}`;
            const qr = await QRCode.toDataURL(shareUrl, {
                width: 140,
                margin: 2,
                color: {
                    dark: '#1A1A1A',
                    light: '#FFFFFF',
                },
            });
            setDownloadQR(qr);
            setUploadStatus('');
        } catch (err: any) {
            console.error('Upload error:', err);
            setUploadError(err.message || 'Something went wrong');
            setUploadStatus('');
        } finally {
            setIsUploading(false);
        }
    }

    const handleRetryUpload = () => {
        if (compositeImage) {
            uploadAndGenerateQR(compositeImage);
        }
    };

    const handlePrint = async () => {
        if (!compositeImage) return;
        resetCountdown(); // Reset timer on interaction

        setIsPrinting(true);

        try {
            // Try to use Tauri print command
            let usedTauri = false;
            try {
                const { invoke } = await import('@tauri-apps/api/core');

                for (let i = 0; i < printCopiesCount; i++) {
                    await invoke('print_photo', {
                        imageData: compositeImage,
                        printerName: null // Use default printer
                    });
                }
                usedTauri = true;
                console.log(`Printed ${printCopiesCount} copies via Tauri`);
                addJob({
                    imageUrl: compositeImage,
                    copies: printCopiesCount,
                    status: 'success',
                    session_id: session?.id
                });
            } catch (tauriErr) {
                console.log('Tauri not available, using browser print:', tauriErr);
            }

            // Fallback to browser print
            if (!usedTauri) {
                const printWindow = window.open('', '_blank');
                if (printWindow) {
                    const imagesHtml = Array(printCopiesCount).fill(0).map(() =>
                        `<div class="page-break"><img src="${compositeImage}" /></div>`
                    ).join('');

                    printWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>ChronoSnap Print</title>
                <style>
                  body { margin: 0; background: white; }
                  .page-break { 
                      display: flex; 
                      justify-content: center; 
                      align-items: center; 
                      min-height: 100vh;
                      page-break-after: always;
                  }
                  .page-break:last-child { page-break-after: auto; }
                  img { max-width: 100%; height: auto; }
                  @media print {
                    body { margin: 0; }
                    img { width: 100%; }
                  }
                </style>
              </head>
              <body>
                ${imagesHtml}
                <script>
                    window.onload = () => {
                        setTimeout(() => {
                            window.print();
                            window.close();
                        }, 500);
                    };
                </script>
              </body>
            </html>
          `);
                    printWindow.document.close();
                    addJob({
                        imageUrl: compositeImage,
                        copies: printCopiesCount,
                        status: 'success',
                        session_id: session?.id
                    });
                }
            }
        } catch (err: any) {
            console.error('Print error:', err);
            addJob({
                imageUrl: compositeImage,
                copies: printCopiesCount,
                status: 'failed',
                session_id: session?.id,
                error: err.message || 'Unknown error'
            });
        } finally {
            setIsPrinting(false);
        }
    };


    const handleNewSession = () => {
        resetSession();
        setStep('idle');
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-screen flex flex-col items-center justify-center p-6 bg-white kiosk overflow-hidden"
        >
            {/* Hidden canvas */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Header */}
            <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center shrink-0 mb-4"
            >
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-border mb-2">
                    <CheckCircle className="w-5 h-5 text-primary" strokeWidth={1.5} />
                </div>
                <h2 className="text-xl font-light mb-1">Your Photo is Ready</h2>
                <p className="text-muted-foreground font-light text-sm">
                    Print or download your photo
                </p>
            </motion.div>

            {/* Main content */}
            <div className="flex-1 flex gap-8 items-center w-full max-w-4xl justify-center py-4">
                {/* Composite preview */}
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="flex items-center justify-center"
                >
                    <div className="elegant-card overflow-hidden">
                        {isCompositing ? (
                            <div className="w-48 aspect-[3/5] flex items-center justify-center bg-muted">
                                <div className="text-center">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
                                    <p className="text-sm text-muted-foreground font-light">Creating photo...</p>
                                </div>
                            </div>
                        ) : (
                            <img
                                src={compositeImage || ''}
                                alt="Final composite"
                                className="max-h-[calc(100vh-220px)] w-auto object-contain"
                            />
                        )}
                    </div>
                </motion.div>

                {/* Actions panel - scrollable to ensure QR is visible */}
                <motion.div
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex flex-col gap-4 max-h-[calc(100vh-180px)] overflow-y-auto hide-scrollbar pr-2"
                >
                    {/* Print button */}
                    <Button
                        size="lg"
                        onClick={handlePrint}
                        disabled={isCompositing || isPrinting}
                        className="px-6 py-5 text-sm font-medium rounded-full elegant-shadow touch-target"
                    >
                        {isPrinting ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <Printer className="w-4 h-4 mr-2" strokeWidth={1.5} />
                        )}
                        <span className="flex-1 text-left">
                            Print Photo &nbsp; <span className="opacity-70 text-xs font-normal">({printCopiesCount} {printCopiesCount === 1 ? 'copy' : 'copies'})</span>
                        </span>
                    </Button>


                    {/* Download QR / Loading State / Error State */}
                    <div className="w-full bg-white border-2 border-primary/30 rounded-2xl p-6 min-h-[220px] flex flex-col items-center justify-center" style={{ minHeight: '220px' }}>
                        {downloadQR ? (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-center w-full"
                            >
                                <div className="mb-4">
                                    <p className="text-[10px] uppercase text-primary font-bold tracking-[0.15em] mb-1">
                                        Scan for softcopy
                                    </p>
                                    <p className="text-[8px] text-muted-foreground font-light">
                                        Download Strip, Photos, & GIF
                                    </p>
                                </div>
                                <div className="bg-white p-2.5 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] inline-block border border-border/50">
                                    <img
                                        src={downloadQR}
                                        alt="Sharing QR Code"
                                        className="w-32 h-32"
                                        style={{ imageRendering: 'pixelated' }}
                                    />
                                </div>
                            </motion.div>
                        ) : uploadError ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-center px-6"
                            >
                                <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <XCircle className="w-6 h-6 text-destructive/60" strokeWidth={1.5} />
                                </div>
                                <p className="text-sm font-medium text-foreground mb-1">Upload Issue</p>
                                <p className="text-[10px] text-muted-foreground font-light mb-4 line-clamp-2">
                                    {uploadError}
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleRetryUpload}
                                    className="rounded-full h-9 px-6 text-[11px] font-medium"
                                >
                                    <RotateCcw className="w-3.5 h-3.5 mr-2" />
                                    Try Again
                                </Button>
                            </motion.div>
                        ) : (
                            <div className="text-center py-6">
                                <div className="relative w-12 h-12 mx-auto mb-4">
                                    <Loader2 className="w-12 h-12 animate-spin text-primary/30" strokeWidth={1} />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-1 h-1 bg-primary rounded-full animate-pulse" />
                                    </div>
                                </div>
                                <p className="text-[10px] uppercase text-muted-foreground/60 font-medium tracking-widest mb-1">
                                    {isCompositing ? 'Preparing' : 'Generating'}
                                </p>
                                <p className="text-[10px] text-muted-foreground font-light px-4">
                                    {uploadStatus || 'Digital copy coming up...'}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* New session button with countdown */}
                    <Button
                        variant="ghost"
                        size="lg"
                        onClick={handleNewSession}
                        className="px-6 py-4 text-sm font-light rounded-full touch-target mt-2"
                    >
                        <RotateCcw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                        New Session ({autoResetCountdown}s)
                    </Button>
                </motion.div>
            </div>

            {/* Processing indicator */}
            {isUploading && (
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute bottom-8 text-xs text-muted-foreground flex items-center gap-2"
                >
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {uploadStatus || 'Processing...'}
                </motion.p>
            )}

            {/* Printing overlay modal */}
            {isPrinting && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl p-10 shadow-2xl flex flex-col items-center gap-6 min-w-[280px]"
                    >
                        <div className="relative">
                            <Printer className="w-12 h-12 text-primary" strokeWidth={1.5} />
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                className="absolute -inset-3"
                            >
                                <div className="w-full h-full rounded-full border-2 border-primary/20 border-t-primary" />
                            </motion.div>
                        </div>
                        <div className="text-center">
                            <h3 className="text-lg font-medium text-foreground mb-1">Printing Your Photo</h3>
                            <p className="text-sm text-muted-foreground">Please wait...</p>
                        </div>
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </motion.div>
                </motion.div>
            )}
        </motion.div>
    );
}
