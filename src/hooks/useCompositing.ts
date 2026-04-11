import { useEffect, useState, RefObject } from 'react';
import { getAssetUrl, getApiUrl } from '@/lib/api';
import { getCachedImageUrl } from '@/lib/frame-cache';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { getFilterByName } from '@/lib/photo-filters';

const PRINT_4R_WIDTH = 1200;
const PRINT_4R_HEIGHT = 1800;
const RUST_TIMEOUT_MS = 20000;
const FETCH_TIMEOUT_MS = 10000;
const IMAGE_LOAD_TIMEOUT_MS = 10000;
const SAFETY_TIMEOUT_MS = 45000;

type SlotLike = {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    layer?: string;
    capture_index?: number;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return new Promise<T>((resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise
            .then((value) => {
                if (timeoutId) clearTimeout(timeoutId);
                resolve(value);
            })
            .catch((error) => {
                if (timeoutId) clearTimeout(timeoutId);
                reject(error);
            });
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Failed converting blob to data URL'));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function loadImageFromSrc(src: string, timeoutMs: number = IMAGE_LOAD_TIMEOUT_MS): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timer = setTimeout(() => {
            reject(new Error('Image load timeout'));
        }, timeoutMs);

        if (!src.startsWith('data:')) {
            img.crossOrigin = 'anonymous';
        }

        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };

        img.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Image load error'));
        };

        img.src = src;
    });
}

function drawImageCover(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    destWidth: number,
    destHeight: number
) {
    if (sourceWidth <= 0 || sourceHeight <= 0 || destWidth <= 0 || destHeight <= 0) return;

    const sourceAspect = sourceWidth / sourceHeight;
    const destAspect = destWidth / destHeight;

    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (sourceAspect > destAspect) {
        sw = sourceHeight * destAspect;
        sx = (sourceWidth - sw) / 2;
    } else {
        sh = sourceWidth / destAspect;
        sy = (sourceHeight - sh) / 2;
    }

    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, destWidth, destHeight);
}

export function useCompositing(canvasRef: RefObject<HTMLCanvasElement | null>, retryNonce: number = 0) {
    const [compositeImage, setCompositeImage] = useState<string | null>(null);
    const [isCompositing, setIsCompositing] = useState(true);

    const { selectedFrame, capturedPhotos, setFinalImage, setPrintImage, setFinalVideoBlob, setFinalVideoUrl, selectedFilter } = useBoothStore();
    const { isVideoMode } = useAdminStore();
    const { booth } = useTenantStore();

    // Helper: proxy external URLs through our API to avoid CORS issues in Tauri
    const getProxiedImageUrl = (url: string): string => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) {
            // Bypass proxy in Tauri/Static environments where /api doesn't exist
            if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || window.location.protocol === 'tauri:')) {
                return url;
            }
            // Avoid double proxying
            if (url.includes('/api/frames/image')) return url;
            return `/api/frames/image?url=${encodeURIComponent(url)}`;
        }
        return url;
    };

    useEffect(() => {
        setIsCompositing(true);
        setCompositeImage(null);

        let compositingDone = false;
        let cancelled = false;

        const safeFinish = (finalDataUrl: string, printDataUrl?: string) => {
            if (cancelled || compositingDone) return;
            setCompositeImage(finalDataUrl);
            setFinalImage(finalDataUrl);
            setPrintImage(printDataUrl || finalDataUrl);
            setIsCompositing(false);
            compositingDone = true;
        };

        const safeFail = (reason: string) => {
            if (cancelled || compositingDone) return;
            console.error('[Compositing] Failed:', reason);
            setCompositeImage(null);
            setFinalImage(null);
            setPrintImage(null);
            setFinalVideoBlob(null);
            setFinalVideoUrl(null);
            setIsCompositing(false);
            compositingDone = true;
        };

        const buildEmergencyComposite = async (
            reason: string,
            canvasWidth: number,
            canvasHeight: number,
            is2R: boolean
        ) => {
            if (cancelled || compositingDone) return;

            console.warn(`[Compositing] Using emergency fallback: ${reason}`);
            const fallbackPhoto = capturedPhotos.find((p) => !!p?.dataUrl)?.dataUrl;

            if (!fallbackPhoto) {
                safeFail(`${reason} (no fallback photo available)`);
                return;
            }

            try {
                const img = await loadImageFromSrc(fallbackPhoto);
                const fallbackCanvas = document.createElement('canvas');
                fallbackCanvas.width = canvasWidth;
                fallbackCanvas.height = canvasHeight;

                const fallbackCtx = fallbackCanvas.getContext('2d');
                if (!fallbackCtx) {
                    safeFail(`${reason} (failed to create fallback canvas context)`);
                    return;
                }

                fallbackCtx.fillStyle = '#ffffff';
                fallbackCtx.fillRect(0, 0, canvasWidth, canvasHeight);
                drawImageCover(
                    fallbackCtx,
                    img,
                    img.naturalWidth,
                    img.naturalHeight,
                    canvasWidth,
                    canvasHeight
                );

                const fallbackFinal = fallbackCanvas.toDataURL('image/jpeg', 0.95);

                if (is2R) {
                    const printCanvas = document.createElement('canvas');
                    printCanvas.width = PRINT_4R_WIDTH;
                    printCanvas.height = PRINT_4R_HEIGHT;

                    const printCtx = printCanvas.getContext('2d');
                    if (!printCtx) {
                        safeFinish(fallbackFinal);
                        return;
                    }

                    printCtx.fillStyle = '#ffffff';
                    printCtx.fillRect(0, 0, PRINT_4R_WIDTH, PRINT_4R_HEIGHT);
                    printCtx.drawImage(fallbackCanvas, 0, 0, canvasWidth, canvasHeight);
                    printCtx.drawImage(fallbackCanvas, canvasWidth, 0, canvasWidth, canvasHeight);

                    const fallbackPrint = printCanvas.toDataURL('image/jpeg', 0.95);
                    safeFinish(fallbackFinal, fallbackPrint);
                    return;
                }

                safeFinish(fallbackFinal);
            } catch (fallbackErr) {
                const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
                safeFail(`${reason} (fallback generation failed: ${msg})`);
            }
        };

        async function compositeImages() {
            if (!selectedFrame || capturedPhotos.length === 0) {
                if (retryNonce === 0) {
                    console.log("Skipping compositing (possibly session reset): missing frame, photos, or canvas ref", {
                        hasFrame: !!selectedFrame,
                        photoCount: capturedPhotos.length,
                    });
                }
                safeFail('Missing frame or captured photos');
                return;
            }

            console.log("Starting compositing process...");
            const canvasWidth = selectedFrame.canvas_width || 1200;
            const canvasHeight = selectedFrame.canvas_height || 1800;

            const hasVideoBlobs = capturedPhotos.some(p => !!p.videoBlob);
            const is2R = canvasWidth <= 600;

            const asRecord = (value: unknown): Record<string, unknown> | null => (
                typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
            );

            const normalizeSlots = (rawSlots: unknown): SlotLike[] => {
                if (!Array.isArray(rawSlots)) return [];

                return rawSlots
                    .map((slot, index: number) => {
                        const s = asRecord(slot) || {};
                        const captureIndex = Number(s.capture_index);

                        return {
                            x: Number(s.x),
                            y: Number(s.y),
                            width: Number(s.width),
                            height: Number(s.height),
                            rotation: Number.isFinite(Number(s.rotation)) ? Number(s.rotation) : 0,
                            layer: s.layer === 'above' ? 'above' : 'below',
                            capture_index: Number.isInteger(captureIndex) ? captureIndex : index,
                        };
                    })
                    .filter((slot) =>
                        Number.isFinite(slot.x) &&
                        Number.isFinite(slot.y) &&
                        Number.isFinite(slot.width) &&
                        Number.isFinite(slot.height) &&
                        slot.width > 0 &&
                        slot.height > 0
                    );
            };

            const slots = normalizeSlots(selectedFrame.photo_slots);

            if (slots.length === 0) {
                await buildEmergencyComposite('No valid photo slots in selected frame', canvasWidth, canvasHeight, is2R);
                return;
            }

            if (!canvasRef.current) {
                // Use setTimeout instead of requestAnimationFrame so it resolves even in background tabs
                await new Promise<void>((resolve) => setTimeout(resolve, 50));
            }

            const canvas = canvasRef.current;
            if (!canvas) {
                await buildEmergencyComposite('Canvas not ready', canvasWidth, canvasHeight, is2R);
                return;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                await buildEmergencyComposite('Failed to get 2D context', canvasWidth, canvasHeight, is2R);
                return;
            }

            canvas.width = canvasWidth;
            canvas.height = canvasHeight;

            // First, check if we are running in Tauri and can use the fast Rust backend
            let isTauri = false;
            let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
            try {
                const tauriApi = await import('@tauri-apps/api/core');
                invoke = tauriApi.invoke;
                isTauri = true;
                console.log("Tauri detected, attempting Rust backend");
            } catch {
                // Not in Tauri
                console.log("Not in Tauri, will use Canvas fallback");
            }

            const resolveUrlToSafeDataUrl = async (rawUrl: string): Promise<string | null> => {
                if (!rawUrl) return null;
                if (rawUrl.startsWith('data:')) return rawUrl;

                const proxied = getProxiedImageUrl(rawUrl);
                const finalUrl = proxied.startsWith('/') ? getApiUrl(proxied) : proxied;

                try {
                    const response = await withTimeout(fetch(finalUrl), FETCH_TIMEOUT_MS, 'Asset fetch');
                    if (!response.ok) {
                        console.warn(`[Compositing] Failed fetching asset ${finalUrl}: ${response.status}`);
                        return null;
                    }

                    const blob = await response.blob();
                    if (blob.size === 0) return null;
                    return await blobToDataUrl(blob);
                } catch (err) {
                    console.warn('[Compositing] Failed resolving safe data URL:', err);
                    return null;
                }
            };

            // Skip Rust backend if we are doing live video compositing
            if (isTauri && invoke && (!isVideoMode || !hasVideoBlobs)) {
                try {
                    let frameBase64: string | undefined = undefined;
                    if (selectedFrame.image_url) {
                        try {
                            const cachedUrl = await getCachedImageUrl(selectedFrame.image_url);
                            if (cachedUrl && cachedUrl.startsWith('data:')) {
                                frameBase64 = cachedUrl;
                            } else {
                                const sourceUrl = cachedUrl || getAssetUrl(selectedFrame.image_url);
                                const urlToUse = getProxiedImageUrl(sourceUrl);
                                const finalFetchUrl = urlToUse.startsWith('/') ? getApiUrl(urlToUse) : urlToUse;

                                const response = await withTimeout(fetch(finalFetchUrl), FETCH_TIMEOUT_MS, 'Frame fetch');
                                if (!response.ok) {
                                    console.warn(`Frame overlay fetch returned ${response.status} — compositing without frame overlay`);
                                } else {
                                    const blob = await response.blob();
                                    if (blob.size > 0) {
                                        frameBase64 = await blobToDataUrl(blob);
                                    } else {
                                        console.warn("Frame blob is empty");
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn("Failed to load frame image for Rust backend (compositing without overlay):", err);
                        }
                    }

                    const req = {
                        frame_base64: frameBase64,
                        frame_width: canvasWidth,
                        frame_height: canvasHeight,
                        photos_base64: capturedPhotos.map(p => p.dataUrl),
                        photo_slots: slots,
                        filter: selectedFilter || 'none',
                        event_hashtag: booth?.event_mode && booth?.event_hashtag ? booth.event_hashtag : undefined
                    };

                    console.log("Calling Rust composite_image_rust with frame:", frameBase64 ? "present" : "missing",
                        "photos:", capturedPhotos.length, "slots:", slots.length);
                    const result = await withTimeout(
                        invoke('composite_image_rust', {
                            req: {
                                ...req,
                                duplicate_for_print: is2R,
                                print_width: PRINT_4R_WIDTH,
                                print_height: PRINT_4R_HEIGHT,
                            }
                        }),
                        RUST_TIMEOUT_MS,
                        'Rust compositing'
                    ) as {
                        final_base64: string;
                        print_base64?: string;
                        slots_rendered: number;
                        slots_failed: number;
                        errors: string[];
                    };

                    console.log("Rust result:", {
                        hasImage: !!result?.final_base64,
                        slotsRendered: result?.slots_rendered,
                        slotsFailed: result?.slots_failed,
                        errors: result?.errors,
                    });

                    if (result && result.final_base64 && result.slots_rendered > 0) {
                        console.log("Rust compositing successful —", result.slots_rendered, "slots rendered");
                        safeFinish(result.final_base64, result.print_base64 || result.final_base64);
                        return;
                    } else {
                        console.error("Rust compositing produced blank image (0 slots rendered), falling back to Canvas.",
                            "Errors:", result?.errors);
                    }
                } catch (err) {
                    console.error("Rust compositing failed, falling back to Canvas:", err);
                }
            }

            console.log("Using Canvas fallback method");
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

            const drawContentInSlot = async (slot: SlotLike, slotIndex: number, filterDef: ReturnType<typeof getFilterByName>, videoElements?: (HTMLVideoElement | null)[]) => {
                const captureIdx = slot.capture_index ?? slotIndex;
                const photo = capturedPhotos[captureIdx];

                if (!photo) return;
                
                // If we are doing video, use the video element directly when it is actually drawable.
                // If not drawable, fall back to the captured still image for this slot.
                if (videoElements && videoElements[captureIdx]) {
                    const videoNode = videoElements[captureIdx]!;
                    const isVideoDrawable =
                        videoNode.videoWidth > 0 &&
                        videoNode.videoHeight > 0 &&
                        videoNode.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

                    if (!isVideoDrawable) {
                        console.warn('[Compositing] Video slot is not drawable yet, falling back to still image', {
                            slotIndex,
                            captureIdx,
                            readyState: videoNode.readyState,
                            videoWidth: videoNode.videoWidth,
                            videoHeight: videoNode.videoHeight,
                        });
                    } else {
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
                }

                if (!photo.dataUrl) return;

                const photoSrc = photo.dataUrl.startsWith('data:')
                    ? photo.dataUrl
                    : await resolveUrlToSafeDataUrl(getAssetUrl(photo.dataUrl));

                if (!photoSrc) {
                    console.error('[Compositing] Could not resolve photo source for slot', slotIndex);
                    return;
                }

                await new Promise<void>((resolve) => {
                    loadImageFromSrc(photoSrc)
                        .then((img) => {
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
                        })
                        .catch(() => {
                            console.error('Canvas drawContentInSlot: failed to load photo image');
                            resolve();
                        });
                });
            };

            const filter = getFilterByName(selectedFilter);
            const doingVideo = isVideoMode && hasVideoBlobs;

            let frameImg: HTMLImageElement | null = null;
            if (selectedFrame.image_url) {
                try {
                    const cachedUrl = await getCachedImageUrl(selectedFrame.image_url!);
                    const frameSource = cachedUrl || getAssetUrl(selectedFrame.image_url!);
                    const frameDataUrl = await resolveUrlToSafeDataUrl(frameSource);
                    if (frameDataUrl) {
                        frameImg = await loadImageFromSrc(frameDataUrl);
                        console.log('Canvas fallback: frame loaded safely via data URL');
                    }
                } catch (frameErr) {
                    console.warn('Canvas fallback: frame load error, continuing without frame overlay', frameErr);
                    frameImg = null;
                }
            }

            const drawFullComposite = async (videoElements?: (HTMLVideoElement | null)[]) => {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                for (let i = 0; i < slots.length; i++) {
                    const slot = slots[i];
                    if (slot.layer === 'above') continue;
                    try {
                        await drawContentInSlot(slot, i, filter, videoElements);
                    } catch {
                        // Keep compositing even if one slot fails
                    }
                }

                if (frameImg) {
                    ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
                }

                for (let i = 0; i < slots.length; i++) {
                    const slot = slots[i];
                    if (slot.layer !== 'above') continue;
                    try {
                        await drawContentInSlot(slot, i, filter, videoElements);
                    } catch {
                        // Keep compositing even if one slot fails
                    }
                }

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

            const doStaticComposite = async () => {
                console.log("Performing static compositing...");
                await drawFullComposite();

                let imageDataUrl: string;
                try {
                    imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
                } catch (exportErr) {
                    throw new Error(`Canvas export failed: ${exportErr instanceof Error ? exportErr.message : String(exportErr)}`);
                }

                console.log("Canvas compositing complete, final image:", imageDataUrl.substring(0, 50) + "...");

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
                    safeFinish(imageDataUrl, printDataUrl);
                } else {
                    safeFinish(imageDataUrl);
                }

                console.log("Image compositing finished successfully");
            };

            if (doingVideo) {
                console.log("Starting Canvas Video Compositing...");
                try {
                    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
                        console.warn("MediaRecorder or captureStream not available, falling back to static compositing");
                        await doStaticComposite();
                        return;
                    }

                    const videoElements = await Promise.all(capturedPhotos.map(async (p, index) => {
                        if (!p.videoBlob || p.videoBlob.size === 0) {
                            if (p.videoBlob && p.videoBlob.size === 0) {
                                console.warn('[Compositing] Empty video blob for capture, will use still image fallback', { index });
                            }
                            return null;
                        }

                        const v = document.createElement('video');
                        const objectUrl = URL.createObjectURL(p.videoBlob);
                        v.src = objectUrl;
                        v.muted = true;
                        v.playsInline = true;
                        v.preload = 'auto';

                        const loaded = await new Promise<boolean>((resolve) => {
                            const timeout = setTimeout(() => {
                                cleanup();
                                resolve(false);
                            }, 2500);

                            const cleanup = () => {
                                clearTimeout(timeout);
                                v.onloadeddata = null;
                                v.onloadedmetadata = null;
                                v.onerror = null;
                            };

                            v.onloadeddata = () => {
                                cleanup();
                                resolve(true);
                            };

                            // Some browsers only fire metadata event early; accept it if dimensions are valid.
                            v.onloadedmetadata = () => {
                                if (v.videoWidth > 0 && v.videoHeight > 0) {
                                    cleanup();
                                    resolve(true);
                                }
                            };

                            v.onerror = () => {
                                cleanup();
                                resolve(false);
                            };
                        });

                        if (!loaded || v.videoWidth <= 0 || v.videoHeight <= 0) {
                            URL.revokeObjectURL(objectUrl);
                            console.warn('[Compositing] Failed to initialize capture video, will use still image fallback', {
                                index,
                                loaded,
                                videoWidth: v.videoWidth,
                                videoHeight: v.videoHeight,
                                readyState: v.readyState,
                            });
                            return null;
                        }

                        return v;
                    }));

                    const hasRenderableVideos = videoElements.some(
                        (v) => !!v && v.videoWidth > 0 && v.videoHeight > 0
                    );
                    if (!hasRenderableVideos) {
                        console.warn('[Compositing] No renderable capture videos; using static composite fallback.');
                        await doStaticComposite();
                        return;
                    }

                    const stream = canvas.captureStream(30);
                    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
                    const mr = new MediaRecorder(stream, { mimeType });
                    const chunks: Blob[] = [];
                    mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

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
                                let printDataUrl = imageDataUrl;
                                if (is2R) {
                                    const printCanvas = document.createElement('canvas');
                                    printCanvas.width = PRINT_4R_WIDTH;
                                    printCanvas.height = PRINT_4R_HEIGHT;
                                    const printCtx = printCanvas.getContext('2d');
                                    if (printCtx) {
                                        printCtx.fillStyle = '#ffffff';
                                        printCtx.fillRect(0, 0, PRINT_4R_WIDTH, PRINT_4R_HEIGHT);
                                        printCtx.drawImage(canvas, 0, 0, canvasWidth, canvasHeight);
                                        printCtx.drawImage(canvas, canvasWidth, 0, canvasWidth, canvasHeight);
                                        printDataUrl = printCanvas.toDataURL('image/jpeg', 0.95);
                                    }
                                }

                                videoElements.forEach(v => {
                                    if (v) URL.revokeObjectURL(v.src);
                                });

                                safeFinish(imageDataUrl, printDataUrl);
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
                        setTimeout(drawFrameLoop, 1000 / 30); // Use setTimeout to prevent hanging on background tab
                    };

                    setTimeout(drawFrameLoop, 0);

                    await videoComplete;
                    return;
                } catch (videoErr) {
                    console.error("Video compositing failed, falling back to static:", videoErr);
                    await doStaticComposite();
                    return;
                }
            } else {
                await doStaticComposite();
            }
        }

        const fallbackWidth = selectedFrame?.canvas_width || 1200;
        const fallbackHeight = selectedFrame?.canvas_height || 1800;
        const fallbackIs2R = fallbackWidth <= 600;

        const safetyTimeout = setTimeout(() => {
            if (!compositingDone) {
                void buildEmergencyComposite('Safety timeout reached', fallbackWidth, fallbackHeight, fallbackIs2R);
            }
        }, SAFETY_TIMEOUT_MS);

        void compositeImages()
            .catch(async (err) => {
                const reason = err instanceof Error ? err.message : String(err);
                console.error("Compositing unhandled error, switching to emergency fallback:", reason);
                await buildEmergencyComposite(reason, fallbackWidth, fallbackHeight, fallbackIs2R);
            })
            .finally(() => {
                clearTimeout(safetyTimeout);
            });

        return () => {
            cancelled = true;
            clearTimeout(safetyTimeout);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFrame, capturedPhotos, setFinalImage, setPrintImage, setFinalVideoBlob, setFinalVideoUrl, selectedFilter, booth, isVideoMode, retryNonce]);

    return { compositeImage, isCompositing };
}
