import { getApiUrl } from '@/lib/api';
import { uploadFinalImageClient, uploadPhotoClient, uploadGifClient } from '@/lib/upload-client';

// -------- IndexedDB helpers (same pattern as frame-cache.ts) --------

const DB_NAME = 'chronosnap-upload-queue';
const STORE_NAME = 'queue';

function getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// -------- Types --------

export interface UploadQueueItem {
    id: string;
    sessionId: string;
    type: 'strip' | 'photo' | 'gif';
    photoIndex?: number;
    dataUrl: string;
    createdAt: number;
    retryCount: number;
    lastError?: string;
    status: 'pending' | 'uploading' | 'failed';
}

// -------- CRUD --------

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function enqueueUpload(
    item: Omit<UploadQueueItem, 'id' | 'retryCount' | 'status'>
): Promise<void> {
    try {
        const db = await getDB();
        const entry: UploadQueueItem = {
            ...item,
            id: generateId(),
            retryCount: 0,
            status: 'pending',
        };
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(entry);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('[UploadQueue] Failed to enqueue:', err);
    }
}

export async function getQueuedUploads(): Promise<UploadQueueItem[]> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(tx.error);
        });
    } catch {
        return [];
    }
}

export async function removeFromQueue(id: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('[UploadQueue] Failed to remove:', err);
    }
}

async function updateQueueItem(item: UploadQueueItem): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('[UploadQueue] Failed to update:', err);
    }
}

export async function getQueueCount(): Promise<number> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(tx.error);
        });
    } catch {
        return 0;
    }
}

// -------- Processing --------

const MAX_RETRIES = 10;

async function processItem(item: UploadQueueItem): Promise<boolean> {
    try {
        const response = await fetch(item.dataUrl);
        const blob = await response.blob();

        switch (item.type) {
            case 'strip':
                await uploadFinalImageClient(item.sessionId, blob);
                break;
            case 'photo':
                await uploadPhotoClient(item.sessionId, item.photoIndex ?? 0, blob);
                break;
            case 'gif':
                await uploadGifClient(item.sessionId, blob);
                break;
        }

        return true;
    } catch (err) {
        console.warn(`[UploadQueue] Failed to process ${item.type} for session ${item.sessionId}:`, err);
        return false;
    }
}

let isProcessing = false;

export async function processQueue(): Promise<number> {
    if (isProcessing) return 0;
    isProcessing = true;

    let processed = 0;

    try {
        const items = await getQueuedUploads();
        const pendingItems = items.filter(i => i.status !== 'uploading' && i.retryCount < MAX_RETRIES);

        for (const item of pendingItems) {
            // Check if we're online before trying
            if (!navigator.onLine) break;

            item.status = 'uploading';
            await updateQueueItem(item);

            const success = await processItem(item);

            if (success) {
                await removeFromQueue(item.id);
                processed++;
                console.log(`[UploadQueue] ✅ Processed ${item.type} for session ${item.sessionId}`);
            } else {
                item.status = 'failed';
                item.retryCount++;
                item.lastError = `Attempt ${item.retryCount} failed`;
                await updateQueueItem(item);
            }
        }
    } finally {
        isProcessing = false;
    }

    return processed;
}
