/**
 * Booth Heartbeat Hook
 * 
 * Sends periodic heartbeat to server to report online status.
 * Used by admin dashboard to track device status.
 */

import { useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';

// Send heartbeat every 60 seconds
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export interface HeartbeatVitals {
    status?: 'online' | 'offline';
    camera_battery?: number | null;
    printer_status?: 'ready' | 'warning' | 'error' | 'unknown';
    prints_remaining?: number | null;
}

interface HeartbeatOptions {
    /** Whether the booth is authenticated */
    isAuthenticated: boolean;
    /** Custom device name (optional) */
    deviceName?: string;
    /** Optional telemetry vitals */
    vitals?: HeartbeatVitals;
}

/**
 * Hook to send periodic heartbeat to server
 */
export function useHeartbeat({ isAuthenticated, deviceName, vitals }: HeartbeatOptions) {
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!isAuthenticated) {
            // Clear interval if not authenticated
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            return;
        }

        // Send heartbeat function
        async function sendHeartbeat() {
            try {
                await apiFetch('/api/booth/heartbeat', {
                    method: 'POST',
                    body: JSON.stringify({ deviceName, vitals }),
                });
            } catch (error) {
                console.error('Heartbeat failed:', error);
            }
        }

        // Send initial heartbeat
        sendHeartbeat();

        // Set up interval
        intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

        // Cleanup on unmount
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [isAuthenticated, deviceName, vitals]);
}
