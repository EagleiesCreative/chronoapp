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
