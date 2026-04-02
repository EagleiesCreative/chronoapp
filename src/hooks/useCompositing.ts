import { useEffect, useState, RefObject } from 'react';
import { getAssetUrl, getApiUrl } from '@/lib/api';
import { getCachedImageUrl } from '@/lib/frame-cache';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { getFilterByName } from '@/lib/photo-filters';

export function useCompositing(canvasRef: RefObject<HTMLCanvasElement | null>) {
    const [compositeImage, setCompositeImage] = useState<string | null>(null);
    const [isCompositing, setIsCompositing] = useState(true);

    const { selectedFrame, capturedPhotos, setFinalImage, setPrintImage, selectedFilter } = useBoothStore();
    const { booth } = useTenantStore();

    // Helper: proxy external URLs through our API to avoid CORS issues in Tauri
    const getProxiedImageUrl = (url: string): string => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) {
            // Avoid double proxying
            if (url.includes('/api/frames/image')) return url;
            return `/api/frames/image?url=${encodeURIComponent(url)}`;
        }
        return url;
    };

    useEffect(() => {
        async function compositeImages() {
            if (!selectedFrame || capturedPhotos.length === 0 || !canvasRef.current) {
                console.log("Skipping compositing: missing frame, photos, or canvas ref");
                return;
            }

            console.log("Starting compositing process...");
            const canvasWidth = selectedFrame.canvas_width || 1200;
            const canvasHeight = selectedFrame.canvas_height || 1800;

            // 4R print dimensions (always print at this size)
            const PRINT_4R_WIDTH = 1200;
            const PRINT_4R_HEIGHT = 1800;
            const is2R = canvasWidth <= 600;

            // First, check if we are running in Tauri and can use the fast Rust backend
            let isTauri = false;
            let invoke: any = null;
            try {
                const tauriApi = await import('@tauri-apps/api/core');
                invoke = tauriApi.invoke;
                isTauri = true;
                console.log("Tauri detected, attempting Rust backend");
            } catch (err) {
                // Not in Tauri
                console.log("Not in Tauri, will use Canvas fallback");
            }

            if (isTauri && invoke) {
                try {
                    // Gather the data for Rust

                    // 1. Get the base64 of the frame PNG
                    let frameBase64: string | undefined = undefined;
                    if (selectedFrame.image_url) {
                        try {
                            const cachedUrl = await getCachedImageUrl(selectedFrame.image_url);

                            // If we have a cached base64, use it directly
                            if (cachedUrl && cachedUrl.startsWith('data:')) {
                                frameBase64 = cachedUrl;
                            } else {
                                const urlToUse = getProxiedImageUrl(cachedUrl || getAssetUrl(selectedFrame.image_url));

                                // Add getApiUrl() to ensure Tauri uses the absolute production URL for the proxy route
                                const finalFetchUrl = urlToUse.startsWith('/') ? getApiUrl(urlToUse) : urlToUse;

                                // Fetch the image as blob, then convert to base64
                                const response = await fetch(finalFetchUrl);
                                if (!response.ok) {
                                    console.warn(`Frame overlay fetch returned ${response.status} — compositing without frame overlay`);
                                } else {
                                    const blob = await response.blob();

                                    // Convert to base64 (skip type check — CDNs may return application/octet-stream)
                                    if (blob.size > 0) {
                                        frameBase64 = await new Promise<string>((resolve, reject) => {
                                            const reader = new FileReader();
                                            reader.onloadend = () => {
                                                if (typeof reader.result === 'string') {
                                                    resolve(reader.result);
                                                } else {
                                                    reject(new Error("Failed to convert frame to base64"));
                                                }
                                            };
                                            reader.onerror = reject;
                                            reader.readAsDataURL(blob);
                                        });
                                    } else {
                                        console.warn("Frame blob is empty");
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn("Failed to load frame image for Rust backend (compositing without overlay):", err);
                        }
                    }

                    // 2. Format the payload
                    const req = {
                        frame_base64: frameBase64,
                        frame_width: canvasWidth,
                        frame_height: canvasHeight,
                        photos_base64: capturedPhotos.map(p => p.dataUrl),
                        photo_slots: selectedFrame.photo_slots || [],
                        filter: selectedFilter || 'none',
                        event_hashtag: booth?.event_mode && booth?.event_hashtag ? booth.event_hashtag : undefined
                    };

                    // 3. Call Rust
                    console.log("Calling Rust composite_image_rust with frame:", frameBase64 ? "present" : "missing");
                    const result: { final_base64: string; print_base64?: string } = await invoke('composite_image_rust', { req: {
                        ...req,
                        duplicate_for_print: is2R,
                        print_width: PRINT_4R_WIDTH,
                        print_height: PRINT_4R_HEIGHT,
                    } });

                    if (result && result.final_base64) {
                        console.log("Rust compositing successful");
                        setCompositeImage(result.final_base64);
                        setFinalImage(result.final_base64);
                        // Print image: use duplicated version if 2R, otherwise same as final
                        setPrintImage(result.print_base64 || result.final_base64);
                        setIsCompositing(false);
                        return; // Successfully composited in Rust!
                    } else {
                        console.error("Rust returned empty result");
                    }
                } catch (err) {
                    console.error("Rust compositing failed, falling back to Canvas:", err);
                    // Fall through to Canvas method
                }
            }

            // ==========================================
            // FALLBACK: HTML5 Canvas Compositing
            // ==========================================

            console.log("Using Canvas fallback method");
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.error("Failed to get canvas 2D context");
                setIsCompositing(false);
                return;
            }

            canvas.width = canvasWidth;
            canvas.height = canvasHeight;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Helper: apply filter to an image using offscreen canvas
            // Uses ctx.filter when available, otherwise falls back to pixel manipulation
            const applyFilterToImage = (img: HTMLImageElement, filterDef: ReturnType<typeof getFilterByName>): HTMLCanvasElement => {
                const offscreen = document.createElement('canvas');
                offscreen.width = img.naturalWidth;
                offscreen.height = img.naturalHeight;
                const offCtx = offscreen.getContext('2d')!;

                // Try ctx.filter first
                const supportsCtxFilter = typeof offCtx.filter !== 'undefined' && offCtx.filter !== undefined;

                if (supportsCtxFilter && filterDef.cssFilter !== 'none') {
                    offCtx.filter = filterDef.cssFilter;
                    offCtx.drawImage(img, 0, 0);
                    offCtx.filter = 'none';
                } else if (filterDef.cssFilter !== 'none') {
                    // Fallback: pixel manipulation for common filters
                    offCtx.drawImage(img, 0, 0);
                    const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
                    const data = imageData.data;

                    if (filterDef.name === 'bw') {
                        for (let j = 0; j < data.length; j += 4) {
                            const gray = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
                            data[j] = data[j + 1] = data[j + 2] = gray;
                        }
                    } else if (filterDef.name === 'vintage') {
                        for (let j = 0; j < data.length; j += 4) {
                            const r = data[j], g = data[j + 1], b = data[j + 2];
                            data[j] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
                            data[j + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
                            data[j + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
                        }
                    } else {
                        // For other filters (warm, cool, film, vivid),
                        // apply simulated adjustments
                        for (let j = 0; j < data.length; j += 4) {
                            if (filterDef.name === 'warm') {
                                data[j] = Math.min(255, data[j] * 1.1);
                                data[j + 2] = data[j + 2] * 0.9;
                            } else if (filterDef.name === 'cool') {
                                data[j] = data[j] * 0.9;
                                data[j + 2] = Math.min(255, data[j + 2] * 1.1);
                            } else if (filterDef.name === 'film') {
                                const gray = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
                                data[j] = Math.min(255, data[j] * 0.85 + gray * 0.15);
                                data[j + 1] = Math.min(255, data[j + 1] * 0.85 + gray * 0.15);
                                data[j + 2] = Math.min(255, data[j + 2] * 0.85 + gray * 0.15);
                            } else if (filterDef.name === 'vivid') {
                                const avg = (data[j] + data[j + 1] + data[j + 2]) / 3;
                                data[j] = Math.min(255, data[j] + (data[j] - avg) * 0.5);
                                data[j + 1] = Math.min(255, data[j + 1] + (data[j + 1] - avg) * 0.5);
                                data[j + 2] = Math.min(255, data[j + 2] + (data[j + 2] - avg) * 0.5);
                            }
                        }
                    }
                    offCtx.putImageData(imageData, 0, 0);
                } else {
                    offCtx.drawImage(img, 0, 0);
                }

                // Apply overlay
                if (filterDef.overlay) {
                    offCtx.fillStyle = filterDef.overlay.color;
                    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
                }

                return offscreen;
            };

            // Helper function to draw a photo in its slot (with filter pre-applied)
            // Uses capture_index to determine which captured photo to render in each slot
            const drawPhotoInSlot = async (slot: any, slotIndex: number, filterDef: ReturnType<typeof getFilterByName>) => {
                const captureIdx = slot.capture_index ?? slotIndex;
                const photo = capturedPhotos[captureIdx];

                if (!photo?.dataUrl) return;

                const img = new Image();
                await new Promise<void>((resolve) => {
                    img.onload = () => {
                        // Pre-apply filter to the photo
                        const filteredCanvas = applyFilterToImage(img, filterDef);

                        const destX = slot.x;
                        const destY = slot.y;
                        const destW = slot.width;
                        const destH = slot.height;

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
                            filteredCanvas,
                            srcX, srcY, srcW, srcH,
                            destX, destY, destW, destH
                        );
                        ctx.restore();
                        resolve();
                    };
                    img.src = photo.dataUrl;
                });
            };

            // Get the active filter
            const filter = getFilterByName(selectedFilter);

            const slots = selectedFrame.photo_slots || [];

            // Draw photos with layer='below' or no layer (default: below)
            console.log(`Drawing ${slots.length} photo slots`);
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                if (slot.layer === 'above') continue;
                try {
                    await drawPhotoInSlot(slot, i, filter);
                } catch (err) {
                    console.error(`Error drawing photo slot ${i}:`, err);
                }
            }

            // Draw frame overlay
            if (selectedFrame.image_url) {
                console.log("Drawing frame overlay from:", selectedFrame.image_url);
                const frameImg = new Image();
                // Don't set crossOrigin - rely on proxy endpoint for R2 URLs
                await new Promise<void>(async (resolve) => {
                    const cachedUrl = await getCachedImageUrl(selectedFrame.image_url);
                    const frameUrl = getProxiedImageUrl(cachedUrl || getAssetUrl(selectedFrame.image_url));

                    // Timeout after 10 seconds
                    const loadTimeout = setTimeout(() => {
                        console.warn("Frame loading timeout after 10 seconds, continuing without frame overlay");
                        resolve();
                    }, 10000);

                    frameImg.onload = () => {
                        clearTimeout(loadTimeout);
                        try {
                            ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
                            console.log("Frame overlay drawn successfully");
                        } catch (err) {
                            console.error("Error drawing frame overlay:", err);
                        }
                        resolve();
                    };
                    frameImg.onerror = () => {
                        clearTimeout(loadTimeout);
                        console.warn(`Frame overlay load failed: ${frameUrl}`);
                        resolve();
                    };
                    frameImg.src = frameUrl;
                });
            } else {
                console.warn("No frame image URL provided");
            }

            // Draw photos with layer='above'
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                if (slot.layer !== 'above') continue;
                try {
                    await drawPhotoInSlot(slot, i, filter);
                } catch (err) {
                    console.error(`Error drawing above-layer photo slot ${i}:`, err);
                }
            }

            // Event mode: draw hashtag overlay
            if (booth?.event_mode && booth?.event_hashtag) {
                ctx.save();
                ctx.font = 'bold 28px Inter, sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.textAlign = 'center';
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 4;
                ctx.fillText(booth.event_hashtag, canvas.width / 2, canvas.height - 30);
                ctx.restore();
            }

            // Share image (original frame size)
            const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
            console.log("Canvas compositing complete, final image:", imageDataUrl.substring(0, 50) + "...");
            setCompositeImage(imageDataUrl);
            setFinalImage(imageDataUrl);

            // Print image: always 4R size
            if (is2R) {
                // Duplicate 2R side-by-side to fill 4R
                const printCanvas = document.createElement('canvas');
                printCanvas.width = PRINT_4R_WIDTH;
                printCanvas.height = PRINT_4R_HEIGHT;
                const printCtx = printCanvas.getContext('2d')!;
                printCtx.fillStyle = '#ffffff';
                printCtx.fillRect(0, 0, PRINT_4R_WIDTH, PRINT_4R_HEIGHT);
                // Left half
                printCtx.drawImage(canvas, 0, 0, canvasWidth, canvasHeight);
                // Right half
                printCtx.drawImage(canvas, canvasWidth, 0, canvasWidth, canvasHeight);
                const printDataUrl = printCanvas.toDataURL('image/jpeg', 0.95);
                setPrintImage(printDataUrl);
            } else {
                setPrintImage(imageDataUrl);
            }

            console.log("Image compositing finished successfully");
            setIsCompositing(false);
        }

        compositeImages();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFrame, capturedPhotos, setFinalImage, setPrintImage, selectedFilter, booth]);

    return { compositeImage, isCompositing };
}
