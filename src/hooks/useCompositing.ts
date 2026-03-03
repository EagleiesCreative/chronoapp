import { useEffect, useState, RefObject } from 'react';
import { getAssetUrl } from '@/lib/api';
import { getCachedImageUrl } from '@/lib/frame-cache';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { getFilterByName } from '@/lib/photo-filters';

export function useCompositing(canvasRef: RefObject<HTMLCanvasElement | null>) {
    const [compositeImage, setCompositeImage] = useState<string | null>(null);
    const [isCompositing, setIsCompositing] = useState(true);

    const { selectedFrame, capturedPhotos, setFinalImage, selectedFilter } = useBoothStore();
    const { booth } = useTenantStore();

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
            const drawPhotoInSlot = async (photoIndex: number, filterDef: ReturnType<typeof getFilterByName>) => {
                const photo = capturedPhotos[photoIndex];
                const slot = selectedFrame.photo_slots?.[photoIndex];

                if (!slot || !photo?.dataUrl) return;

                const img = new Image();
                await new Promise<void>((resolve) => {
                    img.onload = () => {
                        // Pre-apply filter to the photo
                        const filteredCanvas = applyFilterToImage(img, filterDef);

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

            // Draw photos with layer='below' or no layer (default: below)
            for (let i = 0; i < capturedPhotos.length; i++) {
                const slot = selectedFrame.photo_slots?.[i];
                if (!slot || slot.layer === 'above') continue;
                await drawPhotoInSlot(i, filter);
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
                await drawPhotoInSlot(i, filter);
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

            const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
            setCompositeImage(imageDataUrl);
            setFinalImage(imageDataUrl);
            setIsCompositing(false);
        }

        compositeImages();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFrame, capturedPhotos, setFinalImage, selectedFilter, booth]);

    return { compositeImage, isCompositing };
}
