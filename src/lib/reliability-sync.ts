'use client';

import { isTauri } from '@/lib/local-save';

export interface OfflineSessionSyncPayload {
    sessionId: string;
    boothId: string;
    finalImageDataUrl?: string;
    photoDataUrls: string[];
    gifDataUrl?: string;
    contactEmail?: string;
    contactPhone?: string;
    createdAt?: string;
}

export interface SyncQueueStats {
    pending: number;
    syncing: number;
    failed: number;
}

export async function queueSessionSync(payload: OfflineSessionSyncPayload): Promise<string | null> {
    if (!isTauri()) return null;

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string>('queue_session_sync', {
            payload: {
                sessionId: payload.sessionId,
                boothId: payload.boothId,
                finalImageDataUrl: payload.finalImageDataUrl || null,
                photoDataUrls: payload.photoDataUrls,
                gifDataUrl: payload.gifDataUrl || null,
                contactEmail: payload.contactEmail || null,
                contactPhone: payload.contactPhone || null,
                createdAt: payload.createdAt || null,
            },
        });
    } catch (error) {
        console.error('[ReliabilitySync] Failed to enqueue local sync job:', error);
        return null;
    }
}

export async function setReliabilitySyncConfig(apiBaseUrl: string): Promise<void> {
    if (!isTauri() || !apiBaseUrl?.trim()) return;

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_sync_config', { apiBaseUrl, syncSecret: null });
    } catch (error) {
        console.warn('[ReliabilitySync] Failed to set sync config:', error);
    }
}

export async function getReliabilitySyncStats(): Promise<SyncQueueStats | null> {
    if (!isTauri()) return null;

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<SyncQueueStats>('get_sync_queue_stats');
    } catch {
        return null;
    }
}
