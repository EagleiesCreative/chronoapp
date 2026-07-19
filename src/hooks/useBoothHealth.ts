'use client';

import { useState, useEffect } from 'react';
import { getApiUrl } from '@/lib/api';

export function useBoothHealth() {
    const [isOnline, setIsOnline] = useState(true);
    const [cameraStatus, setCameraStatus] = useState<'ok' | 'error' | 'unknown'>('unknown');
    const [lastChecked, setLastChecked] = useState<Date>(new Date());

    useEffect(() => {
        // Initial check
        setIsOnline(navigator.onLine);

        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Ping backend every 30s to verify actual connection
        const interval = setInterval(async () => {
            try {
                // If navigator.onLine is false, don't even try
                if (!navigator.onLine) {
                    setIsOnline(false);
                    return;
                }

                // getApiUrl, not a relative path: inside Tauri "/api/health" resolves to
                // tauri://localhost where no API routes exist, so this always failed and
                // the booth reported itself offline every 30s regardless of connectivity.
                const res = await fetch(getApiUrl('/api/health'));
                setIsOnline(res.ok);
            } catch {
                setIsOnline(false);
            }
            setLastChecked(new Date());

            // Check camera
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const hasVideo = devices.some(d => d.kind === 'videoinput');
                setCameraStatus(hasVideo ? 'ok' : 'error');
            } catch {
                setCameraStatus('error');
            }

        }, 30000);

        // Initial camera check
        if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
            navigator.mediaDevices.enumerateDevices()
                .then(devices => {
                    const hasVideo = devices.some(d => d.kind === 'videoinput');
                    setCameraStatus(hasVideo ? 'ok' : 'error');
                })
                .catch(() => setCameraStatus('error'));
        }

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(interval);
        };
    }, []);

    return { isOnline, cameraStatus, lastChecked };
}
