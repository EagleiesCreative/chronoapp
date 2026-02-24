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

            // Get the active filter
            const filter = getFilterByName(selectedFilter);

            // Draw photos with layer='below' or no layer (default: below)
            for (let i = 0; i < capturedPhotos.length; i++) {
                const slot = selectedFrame.photo_slots?.[i];
                if (!slot || slot.layer === 'above') continue;
                ctx.filter = filter.cssFilter;
                await drawPhotoInSlot(i);
                ctx.filter = 'none';
            }

            // Apply filter overlay (warm/cool tint) BEFORE frame
            if (filter.overlay) {
                ctx.fillStyle = filter.overlay.color;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
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
                ctx.filter = filter.cssFilter;
                await drawPhotoInSlot(i);
                ctx.filter = 'none';
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
