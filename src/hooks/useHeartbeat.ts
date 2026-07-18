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

export function useHeartbeat({ isAuthenticated, deviceName, vitals }: HeartbeatOptions) {
    const vitalsRef = useRef(vitals);
    const deviceNameRef = useRef(deviceName);

    // Keep refs up to date without triggering useEffect re-runs
    useEffect(() => {
        vitalsRef.current = vitals;
    }, [vitals]);

    useEffect(() => {
        deviceNameRef.current = deviceName;
    }, [deviceName]);

    useEffect(() => {
        if (!isAuthenticated) {
            return;
        }

        // Send heartbeat function
        async function sendHeartbeat() {
            try {
                await apiFetch('/api/booth/heartbeat', {
                    method: 'POST',
                    body: JSON.stringify({ 
                        deviceName: deviceNameRef.current, 
                        vitals: vitalsRef.current 
                    }),
                });
            } catch (error) {
                console.error('Heartbeat failed:', error);
            }
        }

        // Send initial heartbeat
        sendHeartbeat();

        // Set up interval
        const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

        // Cleanup on unmount/unauth
        return () => {
            clearInterval(interval);
        };
    }, [isAuthenticated]);
}
