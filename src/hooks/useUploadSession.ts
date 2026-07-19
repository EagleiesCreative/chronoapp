import { useState } from 'react';
import QRCode from 'qrcode';
import { apiFetch, getApiUrl, getAssetUrl } from '@/lib/api';
import { uploadFinalImageClient, uploadPhotoClient, uploadGifClient, uploadVideoClient } from '@/lib/upload-client';
import { saveToLocalDisk } from '@/lib/local-save';
import { generateCompressedGif, generateFramedVideoGif } from '@/lib/video-generator';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { useLocalSaveStore } from '@/store/local-save-store';
import { useTenantStore } from '@/store/tenant-store';
import { enqueueUpload } from '@/lib/upload-queue';
import { queueSessionSync } from '@/lib/reliability-sync';

export function useUploadSession() {
    const { session, capturedPhotos, finalVideoBlob, selectedFrame } = useBoothStore();
    const { isVideoMode } = useAdminStore();
    const { booth } = useTenantStore();

    const [downloadQR, setDownloadQR] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<string>('');
    const [videoGenerated, setVideoGenerated] = useState(false);
    const [gifDownloadUrl, setGifDownloadUrl] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const uploadAndGenerateQR = async (imageDataUrl: string) => {
        setIsUploading(true);
        setUploadError(null);
        try {
            if (!session?.id) {
                throw new Error('No active session found');
            }

            const sessionId = session.id;
            const boothId = booth?.id;

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

            // --- OFFLINE-FIRST QUEUE (Tauri reliability worker) ---
            // Only queue metadata — image uploads are handled by the primary upload path
            // and the upload-queue retry mechanism. This avoids exceeding Vercel's payload limit.
            let queuedSyncJobId: string | null = null;
            if (boothId) {
                queuedSyncJobId = await queueSessionSync({
                    sessionId,
                    boothId,
                    photoDataUrls: [],  // Don't send base64 — too large for Vercel
                    createdAt: new Date().toISOString(),
                });

                if (queuedSyncJobId) {
                    console.log('[ReliabilitySync] Queued local sync job:', queuedSyncJobId);
                }
            }

            // 1. Upload composite strip image (critical - must succeed)
            setUploadStatus('Uploading photo strip...');
            const stripResponse = await fetch(imageDataUrl);
            const stripBlob = await stripResponse.blob();

            let finalUrl: string;
            try {
                finalUrl = await uploadFinalImageClient(sessionId, stripBlob);
            } catch (err) {
                console.warn('Strip upload failed, queuing for retry:', err);
                await enqueueUpload({
                    sessionId,
                    type: 'strip',
                    dataUrl: imageDataUrl,
                    createdAt: Date.now(),
                });
                // Continue — the strip will upload later via retry queue
                finalUrl = '';
            }

            // 2. Upload individual photos (non-critical - continue on failure)
            const photoUrls: string[] = [];

            for (let i = 0; i < capturedPhotos.length; i++) {
                const photo = capturedPhotos[i];
                if (photo.dataUrl) {
                    setUploadStatus(`Uploading photo ${i + 1}/${capturedPhotos.length}...`);
                    try {
                        const photoResponse = await fetch(photo.dataUrl);
                        const photoBlob = await photoResponse.blob();
                        const photoUrl = await uploadPhotoClient(sessionId, i, photoBlob);
                        photoUrls.push(photoUrl);
                    } catch (photoErr) {
                        console.error(`Photo ${i + 1} upload failed, queuing:`, photoErr);
                        await enqueueUpload({
                            sessionId,
                            type: 'photo',
                            photoIndex: i,
                            dataUrl: photo.dataUrl,
                            createdAt: Date.now(),
                        });
                    }
                }
            }

            // 3. Generate and upload media (Video or GIF)
            let gifUrl: string | null = null;
            let videoUrl: string | null = null;

            if (isVideoMode && finalVideoBlob) {
                setUploadStatus('Uploading video...');
                try {
                    videoUrl = await uploadVideoClient(sessionId, finalVideoBlob);
                    setVideoGenerated(true);
                    setGifDownloadUrl(videoUrl);
                    console.log(`Video uploaded: ${(finalVideoBlob.size / 1024).toFixed(1)}KB`);

                    // Save locally
                    if (localSaveEnabled && savePath && localSessionFolder) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const videoDataUrl = reader.result as string;
                            const extension = finalVideoBlob.type.includes('mp4') ? 'mp4' : 'webm';
                            saveToLocalDisk(savePath, localSessionFolder!, `video.${extension}`, videoDataUrl)
                                .then(p => p && console.log('[LocalSave] Video saved:', p))
                                .catch(err => console.error('[LocalSave] Video save failed:', err));
                        };
                        reader.readAsDataURL(finalVideoBlob);
                    }
                } catch (e) {
                    console.error('Video upload failed:', e);
                }
            } else {
                const photoDataUrls = capturedPhotos
                    .map(photo => photo.dataUrl)
                    .filter((dataUrl): dataUrl is string => Boolean(dataUrl));
                
                const videoBlobs = capturedPhotos.map(photo => photo.videoBlob);
                const hasVideoBlobs = videoBlobs.some(b => !!b);
                    
                if (photoDataUrls.length >= 2) {
                    setUploadStatus('Generating animation...');
                    try {
                        let gifResult = null;
                        
                        // If it's video mode and we have video blobs and a frame, compile the framed gif!
                        if (isVideoMode && hasVideoBlobs && selectedFrame?.image_url) {
                            try {
                                const sourceUrl = getAssetUrl(selectedFrame.image_url);
                                // Must go through getApiUrl: a relative "/api/..." path resolves to
                                // tauri://localhost inside the desktop app, where the API routes do
                                // not exist (the build strips src/app/api). That made this fetch fail
                                // every time, so the framed animation silently degraded to a plain GIF.
                                const proxyUrl = getApiUrl(
                                    `/api/frames/image?url=${encodeURIComponent(sourceUrl)}`
                                );

                                // Securely fetch into Blob to prevent Canvas Tainting
                                const frameRes = await fetch(proxyUrl);
                                if (!frameRes.ok) {
                                    throw new Error(`Proxied frame fetch failed (HTTP ${frameRes.status}) for ${proxyUrl}`);
                                }
                                
                                const frameBlob = await frameRes.blob();
                                const safeDataUrl = await new Promise<string>((resolve, reject) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => resolve(reader.result as string);
                                    reader.onerror = reject;
                                    reader.readAsDataURL(frameBlob);
                                });

                                gifResult = await generateFramedVideoGif({
                                    videoBlobs,
                                    photoDataUrls,
                                    frameImageUrl: safeDataUrl,
                                    photoSlots: (selectedFrame.photo_slots as any[]) || [],
                                    canvasWidth: selectedFrame.canvas_width || 1200,
                                    canvasHeight: selectedFrame.canvas_height || 1800,
                                    quality: 15,
                                });
                            } catch (err) {
                                console.warn('Failed to construct framed video GIF, falling back:', err);
                            }
                        }
                        
                        // Fallback to stock compression if previous failed or wasn't applicable
                        if (!gifResult) {
                            gifResult = await generateCompressedGif(photoDataUrls, 1000);
                        }

                        if (gifResult) {
                            setUploadStatus('Uploading animation...');
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
            }

            // 4. Update session with results (mark as completed)
            let completedRemotely = false;
            if (finalUrl) {
                const activeMediaUrl = videoUrl || gifUrl || null;
                setUploadStatus(`Saving ${photoUrls.length} photos and ${activeMediaUrl ? '1 media' : '0 media'}...`);
                const completionPayload = {
                    sessionId,
                    finalImageUrl: finalUrl,
                    photosUrls: photoUrls,
                    videoUrl: activeMediaUrl,
                };

                const completionResponse = await apiFetch('/api/session/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(completionPayload),
                });

                if (!completionResponse.ok) {
                    const errorData = await completionResponse.json();
                    if (!queuedSyncJobId) {
                        throw new Error(errorData.error || `Failed to save session data (${completionResponse.status})`);
                    }
                    console.warn('[ReliabilitySync] Remote completion failed; will sync later:', errorData.error);
                } else {
                    completedRemotely = true;
                }
            }

            if (!completedRemotely && !queuedSyncJobId) {
                throw new Error('Failed to persist session remotely and local reliability queue is unavailable');
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
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Something went wrong';
            console.error('Upload error:', err);
            setUploadError(errorMessage);
            setUploadStatus('');
        } finally {
            setIsUploading(false);
        }
    };

    return {
        downloadQR,
        isUploading,
        uploadStatus,
        videoGenerated,
        gifDownloadUrl,
        uploadError,
        uploadAndGenerateQR
    };
}
