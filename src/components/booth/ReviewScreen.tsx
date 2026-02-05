'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Printer, Download, RotateCcw, CheckCircle, Loader2, Film } from 'lucide-react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { apiFetch, getAssetUrl } from '@/lib/api';
import { useBoothStore } from '@/store/booth-store';
import { generateCompressedGif } from '@/lib/video-generator';

export function ReviewScreen() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [compositeImage, setCompositeImage] = useState<string | null>(null);
    const [downloadQR, setDownloadQR] = useState<string | null>(null);
    const [isCompositing, setIsCompositing] = useState(true);
    const [isPrinting, setIsPrinting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<string>('');
    const [videoGenerated, setVideoGenerated] = useState(false);
    const [autoResetCountdown, setAutoResetCountdown] = useState(60); // 1 minute

    const {
        selectedFrame,
        capturedPhotos,
        session,
        setFinalImage,
        setStep,
        resetSession,
    } = useBoothStore();

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
        setAutoResetCountdown(60);
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
                await new Promise<void>((resolve) => {
                    frameImg.onload = () => {
                        ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
                        resolve();
                    };
                    frameImg.onerror = () => resolve();
                    frameImg.src = getAssetUrl(selectedFrame.image_url);
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
        try {
            // Upload composite strip image
            setUploadStatus('Uploading photo strip...');
            const response = await fetch(imageDataUrl);
            const blob = await response.blob();

            const formData = new FormData();
            formData.append('file', blob, 'final.jpg');
            formData.append('folder', `sessions/${session?.id || 'temp'}`);

            const uploadResponse = await apiFetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await uploadResponse.json();
            let finalUrl: string | null = null;
            let printUrl: string | null = null;

            if (data.success && data.url && session?.id) {
                finalUrl = data.url;
                printUrl = data.url; // Assuming print URL is the same as final image URL for now

                // Upload individual photos
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

                            const photoFormData = new FormData();
                            photoFormData.append('file', photoBlob, `photo_${i + 1}.jpg`);
                            photoFormData.append('folder', `sessions/${session.id}`);

                            const photoUploadResponse = await apiFetch('/api/upload', {
                                method: 'POST',
                                body: photoFormData,
                            });

                            const photoData = await photoUploadResponse.json();
                            if (photoData.success && photoData.url) {
                                photoUrls.push(photoData.url);
                            }
                        } catch (photoErr) {
                            console.error(`Failed to upload photo ${i + 1}:`, photoErr);
                        }
                    }
                }

                // Generate stop-motion GIF
                let gifUrl: string | null = null;
                if (photoDataUrls.length >= 2) {
                    setUploadStatus('Creating stop-motion GIF...');
                    try {
                        const gifResult = await generateCompressedGif(photoDataUrls, 1000);
                        if (gifResult) {
                            setUploadStatus('Uploading GIF...');
                            // Upload GIF
                            const gifFormData = new FormData();
                            gifFormData.append('file', gifResult.blob, 'stopmotion.gif');
                            gifFormData.append('folder', `sessions/${session.id}`);

                            const gifUploadResponse = await apiFetch('/api/upload', {
                                method: 'POST',
                                body: gifFormData,
                            });

                            const gifData = await gifUploadResponse.json();
                            if (gifData.success && gifData.url) {
                                gifUrl = gifData.url;
                                setVideoGenerated(true);
                                console.log(`GIF uploaded: ${(gifResult.size / 1024).toFixed(1)}KB`);
                            }
                        }
                    } catch (gifErr) {
                        console.error('GIF generation failed:', gifErr);
                    }
                }

                // Update session with final image URL, individual photos, video, and mark as completed
                setUploadStatus('Finishing up...');
                await apiFetch('/api/session/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        sessionId: session.id,
                        finalImageUrl: finalUrl,
                        printUrl: printUrl,
                        photoUrls: photoUrls,
                        gifUrl: gifUrl,
                    }),
                }); // Generate QR for share page
                // Use NEXT_PUBLIC_APP_URL for production, fallback to current origin for dev
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
                const shareUrl = `${baseUrl}/share/${session.id}`;
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
            }
        } catch (err) {
            console.error('Upload error:', err);
            setUploadStatus('');
        } finally {
            setIsUploading(false);
        }
    }

    const handlePrint = async () => {
        if (!compositeImage) return;
        resetCountdown(); // Reset timer on interaction

        setIsPrinting(true);

        try {
            // Try to use Tauri print command
            let usedTauri = false;
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('print_photo', {
                    imageData: compositeImage,
                    printerName: null // Use default printer
                });
                usedTauri = true;
                console.log('Photo sent to printer via Tauri');
            } catch (tauriErr) {
                console.log('Tauri not available, using browser print:', tauriErr);
            }

            // Fallback to browser print
            if (!usedTauri) {
                const printWindow = window.open('', '_blank');
                if (printWindow) {
                    printWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>ChronoSnap Print</title>
                <style>
                  body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
                  img { max-width: 100%; height: auto; }
                  @media print {
                    body { margin: 0; }
                    img { width: 100%; }
                  }
                </style>
              </head>
              <body>
                <img src="${compositeImage}" onload="window.print(); window.close();" />
              </body>
            </html>
          `);
                    printWindow.document.close();
                }
            }
        } catch (err) {
            console.error('Print error:', err);
        } finally {
            setIsPrinting(false);
        }
    };

    const handleDownload = () => {
        if (!compositeImage) return;
        resetCountdown(); // Reset timer on interaction

        const link = document.createElement('a');
        link.download = `chronosnap_${Date.now()}.jpg`;
        link.href = compositeImage;
        link.click();
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

                {/* Actions panel */}
                <motion.div
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex flex-col gap-4"
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
                        Print Photo
                    </Button>

                    {/* Download button */}
                    <Button
                        variant="outline"
                        size="lg"
                        onClick={handleDownload}
                        disabled={isCompositing}
                        className="px-6 py-5 text-sm font-normal rounded-full border-border touch-target"
                    >
                        <Download className="w-4 h-4 mr-2" strokeWidth={1.5} />
                        Download
                    </Button>

                    {/* Download QR / Loading State */}
                    {(isUploading || downloadQR) && (
                        <div className="elegant-card p-4 mt-2 min-h-[200px] flex flex-col items-center justify-center">
                            {downloadQR ? (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="text-center"
                                >
                                    <p className="text-[10px] uppercase text-muted-foreground mb-3 font-medium tracking-[0.1em]">
                                        Scan for softcopy
                                    </p>
                                    <div className="bg-white p-2 rounded-xl elegant-shadow">
                                        <img src={downloadQR} alt="Download QR" className="w-32 h-32 mx-auto" />
                                    </div>
                                </motion.div>
                            ) : (
                                <div className="text-center py-4">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary/40" strokeWidth={1.5} />
                                    <p className="text-xs text-muted-foreground font-light px-4">
                                        Generating your QR code...
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

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
