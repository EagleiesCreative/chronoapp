import { useEffect, useState, RefObject } from 'react';
import { getAssetUrl, getApiUrl } from '@/lib/api';
import { getCachedImageUrl } from '@/lib/frame-cache';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { getFilterByName } from '@/lib/photo-filters';

export function useCompositing(canvasRef: RefObject<HTMLCanvasElement | null>) {
    const [compositeImage, setCompositeImage] = useState<string | null>(null);
    const [isCompositing, setIsCompositing] = useState(true);

    const { selectedFrame, capturedPhotos, setFinalImage, setPrintImage, setFinalVideoBlob, setFinalVideoUrl, selectedFilter } = useBoothStore();
    const { isVideoMode } = useAdminStore();
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
        // Track whether compositing completed (for safety timeout)
        let compositingDone = false;

        async function compositeImages() {
            if (!selectedFrame || capturedPhotos.length === 0 || !canvasRef.current) {
                console.log("Skipping compositing: missing frame, photos, or canvas ref", {
                    hasFrame: !!selectedFrame,
                    photoCount: capturedPhotos.length,
                    hasCanvas: !!canvasRef.current
                });
                setIsCompositing(false);
                compositingDone = true;
                return;
            }

            console.log("Starting compositing process...");
            const canvasWidth = selectedFrame.canvas_width || 1200;
            const canvasHeight = selectedFrame.canvas_height || 1800;

            // 4R print dimensions (always print at this size)
            const PRINT_4R_WIDTH = 1200;
            const PRINT_4R_HEIGHT = 1800;
            const hasVideoBlobs = capturedPhotos.some(p => !!p.videoBlob);
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

            // Skip Rust backend if we are doing live video compositing
            if (isTauri && invoke && (!isVideoMode || !hasVideoBlobs)) {
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
                    console.log("Calling Rust composite_image_rust with frame:", frameBase64 ? "present" : "missing",
                        "photos:", capturedPhotos.length, "slots:", (selectedFrame.photo_slots || []).length);
                    const result: {
                        final_base64: string;
                        print_base64?: string;
                        slots_rendered: number;
                        slots_failed: number;
                        errors: string[];
                    } = await invoke('composite_image_rust', { req: {
                        ...req,
                        duplicate_for_print: is2R,
                        print_width: PRINT_4R_WIDTH,
                        print_height: PRINT_4R_HEIGHT,
                    } });

                    console.log("Rust result:", {
                        hasImage: !!result?.final_base64,
                        slotsRendered: result?.slots_rendered,
                        slotsFailed: result?.slots_failed,
                        errors: result?.errors,
                    });

                    // Only accept Rust result if at least one photo slot was rendered
                    if (result && result.final_base64 && result.slots_rendered > 0) {
                        console.log("Rust compositing successful —", result.slots_rendered, "slots rendered");
                        setCompositeImage(result.final_base64);
                        setFinalImage(result.final_base64);
                        // Print image: use duplicated version if 2R, otherwise same as final
                        setPrintImage(result.print_base64 || result.final_base64);
                        setIsCompositing(false);
                        compositingDone = true;
                        return; // Successfully composited in Rust!
                    } else {
                        console.error("Rust compositing produced blank image (0 slots rendered), falling back to Canvas.",
                            "Errors:", result?.errors);
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
            if (!canvas) {
                console.error("Canvas element disappeared during compositing");
                setIsCompositing(false);
                compositingDone = true;
                return;
            }
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.error("Failed to get canvas 2D context");
                setIsCompositing(false);
                compositingDone = true;
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

            // Helper function to draw a photo or video in its slot (with filter pre-applied)
            // Uses capture_index to determine which captured photo to render in each slot
            const drawContentInSlot = async (slot: any, slotIndex: number, filterDef: ReturnType<typeof getFilterByName>, videoElements?: (HTMLVideoElement | null)[]) => {
                const captureIdx = slot.capture_index ?? slotIndex;
                const photo = capturedPhotos[captureIdx];

                if (!photo) return;
                
                // If we are doing video, use the video element directly (filters not yet implemented for video performance reasons)
                if (videoElements && videoElements[captureIdx]) {
                    const videoNode = videoElements[captureIdx]!;
                    const destX = slot.x;
                    const destY = slot.y;
                    const destW = slot.width;
                    const destH = slot.height;
                    const imgAspect = videoNode.videoWidth / videoNode.videoHeight;
                    const slotAspect = destW / destH;

                    let srcX = 0;
                    let srcY = 0;
                    let srcW = videoNode.videoWidth;
                    let srcH = videoNode.videoHeight;

                    if (imgAspect > slotAspect) {
                        srcW = videoNode.videoHeight * slotAspect;
                        srcX = (videoNode.videoWidth - srcW) / 2;
                    } else {
                        srcH = videoNode.videoWidth / slotAspect;
                        srcY = (videoNode.videoHeight - srcH) / 2;
                    }

                    ctx.save();
                    if (slot.rotation) {
                        ctx.translate(destX + destW / 2, destY + destH / 2);
                        ctx.rotate((slot.rotation * Math.PI) / 180);
                        ctx.translate(-(destX + destW / 2), -(destY + destH / 2));
                    }
                    ctx.drawImage(videoNode, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
                    ctx.restore();
                    return;
                }

                // Standard photo fallback
                if (!photo.dataUrl) return;

                const img = new Image();
                await new Promise<void>((resolve) => {
                    // Data URIs do not need (and should avoid) crossOrigin on Safari
                    if (!photo.dataUrl.startsWith('data:')) {
                        img.crossOrigin = 'anonymous';
                    }
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
                    img.onerror = () => {
                        console.error("Canvas drawContentInSlot: failed to load photo image", photo.dataUrl.substring(0, 30) + "...");
                        resolve(); // Must resolve anyway to prevent permanent freeze!
                    };
                    img.src = photo.dataUrl;
                });
            };

            // Get the active filter
            const filter = getFilterByName(selectedFilter);

            const slots = selectedFrame.photo_slots || [];

            // Identify if this is video compositing
            const doingVideo = isVideoMode && hasVideoBlobs;

            // Load frame image first for either mode
            let frameImg: HTMLImageElement | null = null;
            if (selectedFrame.image_url) {
                frameImg = new Image();
                await new Promise<void>(async (resolve) => {
                    const cachedUrl = await getCachedImageUrl(selectedFrame.image_url!);
                    const proxied = getProxiedImageUrl(cachedUrl || getAssetUrl(selectedFrame.image_url!));
                    // CRITICAL: Convert relative proxy URL to absolute for Tauri production
                    const frameUrl = proxied.startsWith('/') ? getApiUrl(proxied) : proxied;
                    console.log("Canvas fallback: loading frame from", frameUrl);
                    const loadTimeout = setTimeout(() => { console.warn("Canvas fallback: Frame load timed out after 10s"); resolve(); }, 10000);
                    frameImg!.crossOrigin = 'anonymous';
                    frameImg!.onload = () => { clearTimeout(loadTimeout); console.log("Canvas fallback: Frame loaded successfully"); resolve(); };
                    frameImg!.onerror = (e) => { console.error("Canvas fallback: Frame load error", e, frameUrl); clearTimeout(loadTimeout); frameImg = null; resolve(); };
                    frameImg!.src = frameUrl;
                });
            }

            const drawFullComposite = async (videoElements?: (HTMLVideoElement | null)[]) => {
                // Background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw photos below layer
                for (let i = 0; i < slots.length; i++) {
                    const slot = slots[i];
                    if (slot.layer === 'above') continue;
                    try { await drawContentInSlot(slot, i, filter, videoElements); } catch (err) {}
                }

                // Draw frame overlay
                if (frameImg) {
                    ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
                }

                // Draw photos above layer
                for (let i = 0; i < slots.length; i++) {
                    const slot = slots[i];
                    if (slot.layer !== 'above') continue;
                    try { await drawContentInSlot(slot, i, filter, videoElements); } catch (err) {}
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
            };

            // Helper: perform static compositing (shared by both paths)
            const doStaticComposite = async () => {
                console.log("Performing static compositing...");
                await drawFullComposite();

                const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
                console.log("Canvas compositing complete, final image:", imageDataUrl.substring(0, 50) + "...");
                setCompositeImage(imageDataUrl);
                setFinalImage(imageDataUrl);

                // Print image: always 4R size
                if (is2R) {
                    const printCanvas = document.createElement('canvas');
                    printCanvas.width = PRINT_4R_WIDTH;
                    printCanvas.height = PRINT_4R_HEIGHT;
                    const printCtx = printCanvas.getContext('2d')!;
                    printCtx.fillStyle = '#ffffff';
                    printCtx.fillRect(0, 0, PRINT_4R_WIDTH, PRINT_4R_HEIGHT);
                    printCtx.drawImage(canvas, 0, 0, canvasWidth, canvasHeight);
                    printCtx.drawImage(canvas, canvasWidth, 0, canvasWidth, canvasHeight);
                    const printDataUrl = printCanvas.toDataURL('image/jpeg', 0.95);
                    setPrintImage(printDataUrl);
                } else {
                    setPrintImage(imageDataUrl);
                }

                console.log("Image compositing finished successfully");
                setIsCompositing(false);
                compositingDone = true;
            };

            if (doingVideo) {
                console.log("Starting Canvas Video Compositing...");
                try {
                    // Check if MediaRecorder is available
                    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
                        console.warn("MediaRecorder or captureStream not available, falling back to static compositing");
                        await doStaticComposite();
                        return;
                    }

                    // Preload all video blobs as playing video elements
                    const videoElements = await Promise.all(capturedPhotos.map(async p => {
                        if (!p.videoBlob) return null;
                        const v = document.createElement('video');
                        v.src = URL.createObjectURL(p.videoBlob);
                        v.muted = true;
                        v.playsInline = true;
                        await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; });
                        return v;
                    }));

                    const stream = canvas.captureStream(30);
                    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
                    const mr = new MediaRecorder(stream, { mimeType });
                    const chunks: Blob[] = [];
                    mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

                    // Wrap onstop in a promise so we can await completion
                    const videoComplete = new Promise<void>((resolve, reject) => {
                        const videoTimeout = setTimeout(() => {
                            console.error("Video compositing timed out after 15s, falling back to static");
                            try { mr.stop(); } catch { /* ignore */ }
                            reject(new Error('Video compositing timeout'));
                        }, 15000);

                        mr.onstop = () => {
                            clearTimeout(videoTimeout);
                            try {
                                const finalBlob = new Blob(chunks, { type: mimeType });
                                const finalUrl = URL.createObjectURL(finalBlob);
                                setFinalVideoBlob(finalBlob);
                                setFinalVideoUrl(finalUrl);
                                console.log("Video compositing complete:", finalUrl);

                                const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
                                setCompositeImage(imageDataUrl);
                                setFinalImage(imageDataUrl);

                                videoElements.forEach(v => {
                                    if (v) URL.revokeObjectURL(v.src);
                                });
                                setIsCompositing(false);
                                compositingDone = true;
                                resolve();
                            } catch (e) {
                                reject(e);
                            }
                        };

                        mr.onerror = (e) => {
                            clearTimeout(videoTimeout);
                            console.error("MediaRecorder error:", e);
                            reject(new Error('MediaRecorder error'));
                        };
                    });

                    mr.start();
                    videoElements.forEach(v => v?.play());

                    const duration = 3000;
                    const startTime = performance.now();

                    const drawFrameLoop = async () => {
                        const now = performance.now();
                        if (now - startTime > duration) {
                            mr.stop();
                            return;
                        }
                        await drawFullComposite(videoElements);
                        requestAnimationFrame(drawFrameLoop);
                    };

                    requestAnimationFrame(drawFrameLoop);

                    // Wait for video to complete or fail
                    await videoComplete;
                    return;
                } catch (videoErr) {
                    console.error("Video compositing failed, falling back to static:", videoErr);
                    // Fall through to static compositing
                    await doStaticComposite();
                    return;
                }
            } else {
                // Static compositing
                await doStaticComposite();
            }
        }

        // Safety timeout: if compositing hangs for any reason, force-clear after 30s
        // This timeout is NOT cleared by .finally() — it checks the compositingDone flag instead
        const safetyTimeout = setTimeout(() => {
            if (!compositingDone) {
                console.error("SAFETY: Compositing timed out after 30s, force-clearing isCompositing");
                setIsCompositing(false);
                compositingDone = true;
            }
        }, 30000);

        compositeImages()
            .catch((err) => {
                console.error("Compositing unhandled error — clearing isCompositing:", err);
                if (!compositingDone) {
                    setIsCompositing(false);
                    compositingDone = true;
                }
            })
            .finally(() => {
                // Only clear timeout if compositing actually completed
                if (compositingDone) {
                    clearTimeout(safetyTimeout);
                }
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFrame, capturedPhotos, setFinalImage, setPrintImage, setFinalVideoBlob, setFinalVideoUrl, selectedFilter, booth, isVideoMode]);

    return { compositeImage, isCompositing };
}
