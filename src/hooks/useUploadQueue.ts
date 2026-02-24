'use client';

import { useEffect, useState, useCallback } from 'react';
import { getQueueCount, processQueue } from '@/lib/upload-queue';

export function useUploadQueue() {
    const [queueCount, setQueueCount] = useState(0);

    const updateCount = useCallback(async () => {
        const count = await getQueueCount();
        setQueueCount(count);
    }, []);

    // Process queue when coming back online
    useEffect(() => {
        const handleOnline = async () => {
            console.log('[UploadQueue] Back online, processing queue...');
            const processed = await processQueue();
            if (processed > 0) {
                console.log(`[UploadQueue] Synced ${processed} uploads`);
            }
            await updateCount();
        };

        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
    }, [updateCount]);

    // Periodic retry every 30s when online
    useEffect(() => {
        const interval = setInterval(async () => {
            if (navigator.onLine) {
                const processed = await processQueue();
                if (processed > 0) {
                    console.log(`[UploadQueue] Background sync: ${processed} uploads`);
                }
                await updateCount();
            }
        }, 30000);

        // Initial count
        updateCount();

        return () => clearInterval(interval);
    }, [updateCount]);

    return { queueCount, refreshQueue: updateCount };
}
