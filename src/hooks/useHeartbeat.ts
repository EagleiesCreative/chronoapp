/**
 * Booth Heartbeat Hook
 * 
 * Sends periodic heartbeat to server to report online status.
 * Used by admin dashboard to track device status.
 */

import { useEffect, useRef } from 'react';

// Send heartbeat every 30 seconds
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

interface HeartbeatOptions {
    /** Whether the booth is authenticated */
    isAuthenticated: boolean;
    /** Custom device name (optional) */
    deviceName?: string;
}

/**
 * Hook to send periodic heartbeat to server
 */
export function useHeartbeat({ isAuthenticated, deviceName }: HeartbeatOptions) {
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
                await fetch('/api/booth/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceName }),
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
    }, [isAuthenticated, deviceName]);
}
