/**
 * Stop Motion GIF Generator
 * 
 * Generates an animated GIF from a sequence of images.
 * Uses gif.js for browser-side GIF encoding.
 * 
 * Constraints:
 * - Maximum 6 seconds duration
 * - Target max file size ~800KB-1MB
 * - GIF format for universal compatibility
 */

import GIF from 'gif.js-upgrade';

interface GifGeneratorOptions {
    /** Array of image URLs or data URLs */
    images: string[];
    /** Delay per frame in milliseconds (default: 500ms) */
    frameDelay?: number;
    /** GIF width (default: 400px) */
    width?: number;
    /** Quality 1-20, lower = better quality but larger (default: 10) */
    quality?: number;
    /** Number of loops through images (default: 2) */
    loops?: number;
}

interface GifResult {
    blob: Blob;
    dataUrl: string;
    duration: number;
    size: number;
}

/**
 * Loads an image and returns a promise
 */
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

/**
 * Generates a stop-motion GIF from images
 */
export async function generateStopMotionGif(
    options: GifGeneratorOptions
): Promise<GifResult> {
    const {
        images,
        frameDelay = 500,
        width = 400,
        quality = 10,
        loops = 2,
    } = options;

    if (images.length === 0) {
        throw new Error('No images provided');
    }

    // Load all images first
    const loadedImages = await Promise.all(images.map(loadImage));

    // Calculate dimensions maintaining aspect ratio
    const firstImage = loadedImages[0];
    const aspectRatio = firstImage.naturalHeight / firstImage.naturalWidth;
    const height = Math.round(width * aspectRatio);

    // Create a canvas for drawing frames
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Create GIF encoder
    const gif = new GIF({
        workers: 2,
        quality: quality,
        width: width,
        height: height,
        workerScript: '/gif.worker.js', // We'll need to copy this to public
    });

    // Add frames - loop through images multiple times
    for (let loop = 0; loop < loops; loop++) {
        for (let i = 0; i < loadedImages.length; i++) {
            const img = loadedImages[i];

            // Clear canvas
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);

            // Draw image with cover fit
            const imgAspect = img.naturalWidth / img.naturalHeight;
            const canvasAspect = width / height;

            let drawWidth, drawHeight, offsetX, offsetY;

            if (imgAspect > canvasAspect) {
                drawHeight = height;
                drawWidth = height * imgAspect;
                offsetX = (width - drawWidth) / 2;
                offsetY = 0;
            } else {
                drawWidth = width;
                drawHeight = width / imgAspect;
                offsetX = 0;
                offsetY = (height - drawHeight) / 2;
            }

            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

            // Add frame to GIF
            gif.addFrame(ctx, { copy: true, delay: frameDelay });
        }
    }

    // Render GIF
    return new Promise((resolve, reject) => {
        gif.on('finished', (blob: Blob) => {
            // Convert to data URL
            const reader = new FileReader();
            reader.onloadend = () => {
                const totalFrames = loadedImages.length * loops;
                resolve({
                    blob,
                    dataUrl: reader.result as string,
                    duration: (totalFrames * frameDelay) / 1000,
                    size: blob.size,
                });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        gif.on('error', reject);
        gif.render();
    });
}

/**
 * Generates GIF and tries different settings to stay under size limit
 */
export async function generateCompressedGif(
    images: string[],
    maxSizeKB: number = 1000
): Promise<GifResult | null> {
    const maxSize = maxSizeKB * 1024;

    // Try different quality/size combinations
    const attempts = [
        { width: 400, quality: 10, loops: 2, frameDelay: 500 },
        { width: 350, quality: 12, loops: 2, frameDelay: 500 },
        { width: 300, quality: 15, loops: 2, frameDelay: 600 },
        { width: 280, quality: 18, loops: 1, frameDelay: 600 },
    ];

    for (const settings of attempts) {
        try {
            const result = await generateStopMotionGif({
                images,
                ...settings,
            });

            if (result.size <= maxSize) {
                console.log(`GIF generated: ${(result.size / 1024).toFixed(1)}KB @ ${settings.width}px`);
                return result;
            }

            console.log(`GIF too large (${(result.size / 1024).toFixed(1)}KB), trying smaller...`);
        } catch (err) {
            console.error('GIF generation attempt failed:', err);
        }
    }

    // Last resort: just return whatever we can generate
    try {
        const result = await generateStopMotionGif({
            images,
            width: 250,
            quality: 20,
            loops: 1,
            frameDelay: 700,
        });
        console.log(`GIF generated (over limit): ${(result.size / 1024).toFixed(1)}KB`);
        return result;
    } catch (err) {
        console.error('Could not generate GIF:', err);
        return null;
    }
}
export interface FramedVideoGifOptions {
    videoBlobs: (Blob | undefined)[];
    photoDataUrls: string[];
    frameImageUrl: string;
    photoSlots: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
        rotation?: number;
        layer?: string;
        capture_index?: number;
    }>;
    canvasWidth: number;
    canvasHeight: number;
    quality?: number;
}

export async function generateFramedVideoGif(
    options: FramedVideoGifOptions
): Promise<GifResult | null> {
    const {
        videoBlobs,
        photoDataUrls,
        frameImageUrl,
        photoSlots,
        canvasWidth,
        canvasHeight,
        quality = 10,
    } = options;

    try {
        // Downscale output to keep GIF size manageable
        let scale = 1;
        if (canvasWidth > 600) {
            scale = 600 / canvasWidth;
        }
        const outWidth = Math.round(canvasWidth * scale);
        const outHeight = Math.round(canvasHeight * scale);

        const canvas = document.createElement('canvas');
        canvas.width = outWidth;
        canvas.height = outHeight;
        const ctx = canvas.getContext('2d')!;

        // 1. Load the frame image securely
        const frameImg = new Image();
        frameImg.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            frameImg.onload = resolve;
            frameImg.onerror = reject;
            frameImg.src = frameImageUrl;
        });

        // 2. Load Fallback Images
        const fallbackImages = await Promise.all(
            photoDataUrls.map(src => {
                if (!src) return Promise.resolve(null);
                return new Promise<HTMLImageElement | null>((resolve) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => resolve(img);
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            })
        );

        // 3. Load Video Elements
        const videoElements = await Promise.all(videoBlobs.map(async (blob, i) => {
            if (!blob) return null;
            const v = document.createElement('video');
            const url = URL.createObjectURL(blob);
            v.src = url;
            v.muted = true;
            v.playsInline = true;
            
            return new Promise<HTMLVideoElement | null>((resolve) => {
                const timeout = setTimeout(() => resolve(null), 2000);
                v.onloadeddata = () => {
                    clearTimeout(timeout);
                    resolve(v);
                };
                v.onerror = () => {
                    clearTimeout(timeout);
                    resolve(null);
                };
            });
        }));

        const gif = new GIF({
            workers: 2,
            quality: quality,
            width: outWidth,
            height: outHeight,
            workerScript: '/gif.worker.js',
        });

        // Framerate logic
        const fps = 10;
        const durationSec = 3.0; // 3 seconds total
        const totalFrames = Math.floor(durationSec * fps);
        const frameDelay = 1000 / fps;

        videoElements.forEach(v => {
            if (v) {
                v.currentTime = 0;
            }
        });

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
            // Seek all videos to current time
            const t = frameIndex / fps;
            await Promise.all(videoElements.map(v => {
                if (!v) return Promise.resolve();
                return new Promise<void>((resolve) => {
                    const seekHandler = () => {
                        v.removeEventListener('seeked', seekHandler);
                        resolve();
                    };
                    v.addEventListener('seeked', seekHandler);
                    v.currentTime = t;
                    // Provide a timeout just in case seek fails
                    setTimeout(() => {
                        v.removeEventListener('seeked', seekHandler);
                        resolve();
                    }, 500);
                });
            }));

            // Clear
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, outWidth, outHeight);

            // Draw below slots
            const drawSlot = (slot: any) => {
                const captureIdx = slot.capture_index ?? 0;
                const destX = slot.x * scale;
                const destY = slot.y * scale;
                const destW = slot.width * scale;
                const destH = slot.height * scale;
                const slotAspect = destW / destH;

                ctx.save();
                if (slot.rotation) {
                    ctx.translate(destX + destW / 2, destY + destH / 2);
                    ctx.rotate((slot.rotation * Math.PI) / 180);
                    ctx.translate(-(destX + destW / 2), -(destY + destH / 2));
                }

                const v = videoElements[captureIdx];
                const fb = fallbackImages[captureIdx];

                if (v && v.videoWidth > 0) {
                    const vAspect = v.videoWidth / v.videoHeight;
                    let sW = v.videoWidth, sH = v.videoHeight, sX = 0, sY = 0;
                    if (vAspect > slotAspect) {
                        sW = v.videoHeight * slotAspect;
                        sX = (v.videoWidth - sW) / 2;
                    } else {
                        sH = v.videoWidth / slotAspect;
                        sY = (v.videoHeight - sH) / 2;
                    }
                    ctx.drawImage(v, sX, sY, sW, sH, destX, destY, destW, destH);
                } else if (fb) {
                    const fbAspect = fb.naturalWidth / fb.naturalHeight;
                    let sW = fb.naturalWidth, sH = fb.naturalHeight, sX = 0, sY = 0;
                    if (fbAspect > slotAspect) {
                        sW = fb.naturalHeight * slotAspect;
                        sX = (fb.naturalWidth - sW) / 2;
                    } else {
                        sH = fb.naturalWidth / slotAspect;
                        sY = (fb.naturalHeight - sH) / 2;
                    }
                    ctx.drawImage(fb, sX, sY, sW, sH, destX, destY, destW, destH);
                }
                ctx.restore();
            };

            photoSlots.filter(s => s.layer !== 'above').forEach(drawSlot);
            
            // Draw Frame
            ctx.drawImage(frameImg, 0, 0, outWidth, outHeight);

            // Draw above slots
            photoSlots.filter(s => s.layer === 'above').forEach(drawSlot);

            gif.addFrame(ctx, { copy: true, delay: frameDelay });
        }

        // Cleanup object URLs
        videoElements.forEach(v => {
            if (v && v.src) URL.revokeObjectURL(v.src);
        });

        return new Promise((resolve, reject) => {
            gif.on('finished', (blob: Blob) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve({
                        blob,
                        dataUrl: reader.result as string,
                        duration: durationSec,
                        size: blob.size,
                    });
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            gif.on('error', reject);
            gif.render();
        });

    } catch (err) {
        console.error('Framed video GIF encoding failed:', err);
        return null;
    }
}
