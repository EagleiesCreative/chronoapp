import { useState } from 'react';
import QRCode from 'qrcode';
import { apiFetch } from '@/lib/api';
import { uploadFinalImageClient, uploadPhotoClient, uploadGifClient } from '@/lib/upload-client';
import { saveToLocalDisk } from '@/lib/local-save';
import { generateCompressedGif } from '@/lib/video-generator';
import { useBoothStore } from '@/store/booth-store';
import { useLocalSaveStore } from '@/store/local-save-store';
import { enqueueUpload } from '@/lib/upload-queue';

export function useUploadSession() {
    const { session, capturedPhotos } = useBoothStore();

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
            const photoDataUrls: string[] = [];

            for (let i = 0; i < capturedPhotos.length; i++) {
                const photo = capturedPhotos[i];
                if (photo.dataUrl) {
                    setUploadStatus(`Uploading photo ${i + 1}/${capturedPhotos.length}...`);
                    photoDataUrls.push(photo.dataUrl);
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

            // 3. Generate and upload stop-motion GIF (non-critical)
            let gifUrl: string | null = null;
            if (photoDataUrls.length >= 2) {
                setUploadStatus('Creating stop-motion GIF...');
                try {
                    const gifResult = await generateCompressedGif(photoDataUrls, 1000);
                    if (gifResult) {
                        setUploadStatus('Uploading GIF...');
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

            // 4. Update session with results (mark as completed)
            setUploadStatus(`Saving ${photoUrls.length} photos and ${gifUrl ? '1 gif' : '0 gif'}...`);
            const completionPayload = {
                sessionId,
                finalImageUrl: finalUrl,
                photosUrls: photoUrls,
                videoUrl: gifUrl,
            };

            const completionResponse = await apiFetch('/api/session/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(completionPayload),
            });

            if (!completionResponse.ok) {
                const errorData = await completionResponse.json();
                throw new Error(errorData.error || `Failed to save session data (${completionResponse.status})`);
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
