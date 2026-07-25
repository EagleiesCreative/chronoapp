import { useEffect, useState, useRef, RefObject } from 'react';
import { getAssetUrl, getApiUrl } from '@/lib/api';
import { getCachedImageUrl } from '@/lib/frame-cache';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
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

function isTauriRuntimeEnvironment(): boolean {
    if (typeof window === 'undefined') return false;

    const ua = window.navigator?.userAgent || '';
    const protocol = window.location?.protocol || '';
    const host = window.location?.host || '';

    return (
        '__TAURI_INTERNALS__' in window ||
        '__TAURI__' in window ||
        ua.includes('Tauri') ||
        protocol === 'tauri:' ||
        host === 'tauri.localhost'
    );
}

export function useCompositing(canvasRef: RefObject<HTMLCanvasElement | null>, retryNonce: number = 0) {
    const [compositeImage, setCompositeImage] = useState<string | null>(null);
    const [isCompositing, setIsCompositing] = useState(true);
    const [compositeWarning, setCompositeWarning] = useState<string | null>(null);

    const { selectedFrame, capturedPhotos, setFinalImage, setPrintImage, setFinalVideoBlob, setFinalVideoUrl, selectedFilter } = useBoothStore();
    const { isVideoMode, isCameraMirrored } = useAdminStore();
    const { booth } = useTenantStore();
    const activeSession = useSessionProfileStore((s) => s.activeSession);

    // Keep refs so the effect closure always reads the latest values
    // without needing them in the dependency array (which would retrigger
    // the effect when resetSession() clears the store).
    const selectedFrameRef = useRef(selectedFrame);
    const capturedPhotosRef = useRef(capturedPhotos);
    const selectedFilterRef = useRef(selectedFilter);
    const boothRef = useRef(booth);
    const isVideoModeRef = useRef(isVideoMode);
    const isCameraMirroredRef = useRef(isCameraMirrored);
    const activeSessionRef = useRef(activeSession);

    // Synchronise refs on every render so the effect closure is never stale.
    selectedFrameRef.current = selectedFrame;
    capturedPhotosRef.current = capturedPhotos;
    selectedFilterRef.current = selectedFilter;
    boothRef.current = booth;
    isVideoModeRef.current = isVideoMode;
    isCameraMirroredRef.current = isCameraMirrored;
    activeSessionRef.current = activeSession;

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

    // The effect intentionally does NOT depend on selectedFrame, capturedPhotos,
    // selectedFilter, booth, or isVideoMode. Those are read through refs so that
    // resetSession() clearing the store does not re-trigger the expensive
    // compositing work (or fire a spurious "Missing frame" error).
    //
    // Compositing re-runs ONLY when:
    //   1. The component mounts (initial render)
    //   2. retryNonce changes (user explicitly retrying)
    useEffect(() => {
        // Snapshot current values from refs
        const frame = selectedFrameRef.current;
        const photos = capturedPhotosRef.current;
        const filter = selectedFilterRef.current;
        const boothData = boothRef.current;
        const videoMode = isVideoModeRef.current;
        // Stills are already mirror-baked by react-webcam's `mirrored` option, but
        // the recorded live-video clips come from the raw MediaStream (unmirrored).
        // Flip the video draw to match the stills when the camera is mirrored.
        const mirrored = isCameraMirroredRef.current;
        // Configurable Live Video clip length (session overrides booth), clamped so
        // the uploaded clip stays under the size limit.
        const liveVideoSec = Math.min(8, Math.max(2,
            activeSessionRef.current?.live_video_seconds ?? boothData?.live_video_seconds ?? 3));

        setIsCompositing(true);
        setCompositeImage(null);
        setCompositeWarning(null);

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

            console.warn(`[Compositing] ⚠️ Using emergency fallback: ${reason}`);
            setCompositeWarning(`Emergency fallback: ${reason}`);
            const fallbackPhoto = photos.find((p) => !!p?.dataUrl)?.dataUrl;

            if (!fallbackPhoto) {
                safeFail(`${reason} (no fallback photo available)`);
                return;
            }

            // In Tauri (WKWebView), canvas.toDataURL() throws SecurityError ("The operation is insecure")
            // when ANY image (even data URLs) is drawn to the canvas. 
            // Bypass this by using the photo's data URL directly as the composite image.
            const isTauriEnv = isTauriRuntimeEnvironment();
            
            if (isTauriEnv) {
                console.log('[Compositing] Tauri environment — using photo data URL directly (bypassing canvas)');
                safeFinish(fallbackPhoto, fallbackPhoto);
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
            if (!frame || photos.length === 0) {
                console.warn("[Compositing] Skipping — no frame or photos available at mount time.", {
                    hasFrame: !!frame,
                    photoCount: photos.length,
                    retryNonce,
                });
                // Don't call safeFail here — this is expected during session reset / teardown.
                // Just silently stop compositing so the UI doesn't show a scary red error.
                setIsCompositing(false);
                compositingDone = true;
                return;
            }

            const canvasWidth = frame.canvas_width || 1200;
            const canvasHeight = frame.canvas_height || 1800;

            const hasVideoBlobs = photos.some(p => !!p.videoBlob);
            const is2R = canvasWidth <= 600;

            console.log("[Compositing] Starting...", {
                frameId: frame.id,
                frameName: frame.name,
                canvasWidth,
                canvasHeight,
                photoCount: photos.length,
                photoDataUrlLengths: photos.map((p, i) => `photo[${i}]: ${p.dataUrl?.length ?? 0} chars`),
                slotCount: frame.photo_slots?.length ?? 0,
                hasVideoBlobs,
                is2R,
                filter,
            });

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

            const slots = normalizeSlots(frame.photo_slots);

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

            // Still image produced by the Rust compositor (Tauri only). When a Live
            // Video clip is also being built we hold this back until recording is done,
            // so the upload sees the finished clip instead of racing past it.
            let rustFinalImage: string | null = null;
            let rustPrintImage: string | null = null;

            // First, check if we are running in Tauri runtime before attempting Rust backend.
            const isTauri = isTauriRuntimeEnvironment();
            let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
            if (isTauri) {
                try {
                    const tauriApi = await import('@tauri-apps/api/core');
                    invoke = tauriApi.invoke;
                    console.log('Tauri runtime detected, attempting Rust backend');
                } catch (importErr) {
                    console.warn('[Compositing] Tauri runtime detected but failed to import API core:', importErr);
                }
            } else {
                console.log('Not in Tauri runtime, using Canvas fallback');
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

            // In Tauri, Canvas fallback and video captureStream ALWAYS fail due to WKWebView security.
            // Always run the Rust backend to generate at least a framed static composite image ('ticket') 
            // for the QR code upload, even if operating in video mode.
            if (isTauri && invoke) {
                try {
                    let frameBase64: string | undefined = undefined;
                    if (frame.image_url) {
                        try {
                            const cachedUrl = await getCachedImageUrl(frame.image_url);
                            if (cachedUrl && cachedUrl.startsWith('data:')) {
                                frameBase64 = cachedUrl;
                            } else {
                                const sourceUrl = cachedUrl || getAssetUrl(frame.image_url);
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
                            const msg = `Frame fetch failed: ${err instanceof Error ? err.message : String(err)}`;
                            console.warn(`[Compositing] ${msg}`);
                            setCompositeWarning(msg);
                        }
                    }

                    const req = {
                        frame_base64: frameBase64,
                        frame_width: canvasWidth,
                        frame_height: canvasHeight,
                        photos_base64: photos.map(p => p.dataUrl),
                        // Send raw photo_slots from the frame (not normalized) so Rust gets the full object including `id`
                        photo_slots: (frame.photo_slots as unknown[]).map((raw, i) => {
                            const s = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
                            const ci = Number(s.capture_index);
                            return {
                                id: String(s.id ?? `slot_${i}`),
                                x: Number(s.x) || 0,
                                y: Number(s.y) || 0,
                                width: Number(s.width) || 0,
                                height: Number(s.height) || 0,
                                rotation: Number.isFinite(Number(s.rotation)) ? Number(s.rotation) : 0,
                                layer: s.layer === 'above' ? 'above' : 'below',
                                capture_index: Number.isInteger(ci) ? ci : i,
                            };
                        }),
                        filter: filter || 'none',
                        event_hashtag: boothData?.event_mode && boothData?.event_hashtag ? boothData.event_hashtag : undefined
                    };

                    console.log("Calling Rust composite_image_rust with frame:", frameBase64 ? "present" : "missing",
                        "photos:", photos.length, "slots:", slots.length);
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
                        if (result.errors?.length > 0) {
                            setCompositeWarning(`Rust compositing had warnings: ${result.errors.join('; ')}`);
                        }
                        rustFinalImage = result.final_base64;
                        rustPrintImage = result.print_base64 || result.final_base64;

                        // Live Video: Rust only produces a still. Historically we returned
                        // here, so the desktop app never produced a video clip and the web
                        // share silently fell back to a GIF. Instead, fall through to the
                        // canvas recorder to build the clip, then publish the still once
                        // recording finishes (publishing early would start the upload
                        // before the clip exists). Everything below is wrapped in
                        // try/catch, so if the WKWebView refuses (tainted canvas / no
                        // MediaRecorder) we still finish with the Rust image as before.
                        if (videoMode && hasVideoBlobs) {
                            console.log('[Compositing] Tauri: Rust still ready — attempting canvas Live Video clip before publishing...');
                        } else {
                            safeFinish(rustFinalImage, rustPrintImage);
                            return;
                        }
                    } else {
                        const msg = `Rust compositing produced blank image (0 slots rendered). Errors: ${result?.errors?.join('; ') || 'none'}`;
                        console.error(`[Compositing] ${msg}`);
                        setCompositeWarning(msg);
                        // In Tauri, Canvas fallback will fail with SecurityError — go directly to emergency
                        await buildEmergencyComposite(msg, canvasWidth, canvasHeight, is2R);
                        return;
                    }
                } catch (err) {
                    const msg = `Rust compositing failed: ${err instanceof Error ? err.message : String(err)}`;
                    const isTimeout = /timed out/i.test(msg);
                    if (isTimeout) {
                        console.warn(`[Compositing] ${msg} — falling back to emergency composite`);
                    } else {
                        console.error(`[Compositing] ${msg}`);
                    }
                    setCompositeWarning(msg);
                    // In Tauri, Canvas fallback will fail with SecurityError — go directly to emergency
                    await buildEmergencyComposite(msg, canvasWidth, canvasHeight, is2R);
                    return;
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
                const photo = photos[captureIdx];

                if (!photo) {
                    console.warn(`[Canvas] Slot ${slotIndex}: no photo at captureIdx=${captureIdx} (photos.length=${photos.length})`);
                    return;
                }
                if (!photo.dataUrl) {
                    console.warn(`[Canvas] Slot ${slotIndex}: photo exists but dataUrl is empty`);
                    return;
                }
                
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
                        if (mirrored) {
                            // Horizontal flip within the slot so the clip matches the mirrored still.
                            ctx.translate(destX + destW, destY);
                            ctx.scale(-1, 1);
                            ctx.drawImage(videoNode, srcX, srcY, srcW, srcH, 0, 0, destW, destH);
                        } else {
                            ctx.drawImage(videoNode, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
                        }
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
                        .catch((loadErr) => {
                            const errMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
                            console.error(`[Canvas] drawContentInSlot slot ${slotIndex} failed: ${errMsg}`);
                            setCompositeWarning(`Canvas slot ${slotIndex} failed: ${errMsg}`);
                            resolve();
                        });
                });
            };

            const filterDef = getFilterByName(filter);
            const doingVideo = videoMode && hasVideoBlobs;

            // When we reach the canvas recorder purely to add a Live Video clip (Tauri:
            // the Rust compositor already published the still image), re-running the
            // canvas static composite is pointless and throws SecurityError in WKWebView.
            const staticFallbackIfNeeded = async () => {
                if (compositingDone) {
                    console.log('[Compositing] Still image already published — skipping canvas static composite.');
                    return;
                }
                if (rustFinalImage) {
                    console.log('[Compositing] Publishing Rust still image (canvas video path unavailable).');
                    safeFinish(rustFinalImage, rustPrintImage || rustFinalImage);
                    return;
                }
                await doStaticComposite();
            };

            let frameImg: HTMLImageElement | null = null;
            if (frame.image_url) {
                try {
                    const cachedUrl = await getCachedImageUrl(frame.image_url!);
                    const frameSource = cachedUrl || getAssetUrl(frame.image_url!);
                    const frameDataUrl = await resolveUrlToSafeDataUrl(frameSource);
                    if (frameDataUrl) {
                        frameImg = await loadImageFromSrc(frameDataUrl);
                        console.log('Canvas fallback: frame loaded safely via data URL');
                    }
                } catch (frameErr) {
                    const msg = `Canvas fallback: frame load error — ${frameErr instanceof Error ? frameErr.message : String(frameErr)}`;
                    console.warn(msg);
                    setCompositeWarning(msg);
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
                        await drawContentInSlot(slot, i, filterDef, videoElements);
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
                        await drawContentInSlot(slot, i, filterDef, videoElements);
                    } catch {
                        // Keep compositing even if one slot fails
                    }
                }

                if (boothData?.event_mode && boothData?.event_hashtag) {
                    ctx.save();
                    ctx.font = 'bold 28px Inter, sans-serif';
                    ctx.fillStyle = 'rgba(255,255,255,0.85)';
                    ctx.textAlign = 'center';
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 4;
                    ctx.fillText(boothData.event_hashtag, canvas.width / 2, canvas.height - 30);
                    ctx.restore();
                }
            };

            const doStaticComposite = async () => {
                console.log("[Canvas] Performing static compositing...");
                await drawFullComposite();

                // Blank-canvas detection: Sample center + slot centers.
                // If everything is white (255,255,255), the composite is likely blank.
                const samplePoints = [
                    { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) },
                    ...slots.slice(0, 4).map(s => ({
                        x: Math.floor(s.x + s.width / 2),
                        y: Math.floor(s.y + s.height / 2),
                    }))
                ];
                const allWhite = samplePoints.every(p => {
                    const px = ctx.getImageData(p.x, p.y, 1, 1).data;
                    return px[0] >= 250 && px[1] >= 250 && px[2] >= 250;
                });
                if (allWhite) {
                    console.warn("[Canvas] ⚠️ All sampled pixels are white — composite appears BLANK");
                    setCompositeWarning("Canvas produced a blank white image — photos may have failed to load in this environment");
                }

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
                        await staticFallbackIfNeeded();
                        return;
                    }

                    const videoElements = await Promise.all(photos.map(async (p, index) => {
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
                        // Loop the source so a short recorded clip fills the full
                        // (possibly longer) configured Live Video duration smoothly.
                        v.loop = true;

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
                        await staticFallbackIfNeeded();
                        return;
                    }

                    const stream = canvas.captureStream(30);
                    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
                    // Cap the bitrate so the ~3s clip stays comfortably under the
                    // upload body limit (~4.5MB on serverless). Without this, large /
                    // high-motion (e.g. 4R landscape) frames produced multi-MB clips
                    // that were rejected on upload, so the live video was missing from
                    // the web share for some sessions. ~2.5 Mbps × 3s ≈ 0.9MB.
                    const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
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

                                // A zero-byte blob means the webview gave us nothing to
                                // record (e.g. tainted canvas). Don't publish it — the
                                // upload would fail and the GIF fallback is better.
                                if (finalBlob.size === 0) {
                                    console.warn('[Compositing] Recorded clip is empty — skipping Live Video for this session.');
                                    videoElements.forEach(v => { if (v) URL.revokeObjectURL(v.src); });
                                    resolve();
                                    return;
                                }

                                const finalUrl = URL.createObjectURL(finalBlob);
                                setFinalVideoBlob(finalBlob);
                                setFinalVideoUrl(finalUrl);
                                console.log(`Video compositing complete: ${(finalBlob.size / 1024).toFixed(1)}KB`, finalUrl);

                                // In the Tauri webview the still image is already published
                                // by the Rust compositor, and canvas.toDataURL() can throw
                                // SecurityError here. Never let that discard the clip we
                                // just recorded.
                                let imageDataUrl: string;
                                try {
                                    imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
                                } catch (exportErr) {
                                    console.warn('[Compositing] Canvas export unavailable after recording (keeping Live Video):', exportErr);
                                    videoElements.forEach(v => { if (v) URL.revokeObjectURL(v.src); });
                                    resolve();
                                    return;
                                }
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

                    const duration = liveVideoSec * 1000;
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
                    // Tauri: the clip is recorded (or was skipped) — now publish the
                    // Rust still image so the upload runs with the clip available.
                    await staticFallbackIfNeeded();
                    return;
                } catch (videoErr) {
                    console.error("Video compositing failed, falling back to static:", videoErr);
                    await staticFallbackIfNeeded();
                    return;
                }
            } else {
                await doStaticComposite();
            }
        }

        const fallbackWidth = frame?.canvas_width || 1200;
        const fallbackHeight = frame?.canvas_height || 1800;
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
    }, [retryNonce, setFinalImage, setPrintImage, setFinalVideoBlob, setFinalVideoUrl]);

    return { compositeImage, isCompositing, compositeWarning };
}
