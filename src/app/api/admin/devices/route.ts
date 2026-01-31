import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuthWithApiKey } from '@/lib/admin-auth';

// Consider device offline if no heartbeat in last 2 minutes
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

interface DeviceStatus {
    booth_id: string;
    booth_name: string;
    booth_code: string;
    location: string | null;
    organization_id: string;
    device_name: string | null;
    device_ip: string | null;
    status: 'online' | 'offline' | 'never_connected';
    last_heartbeat: string | null;
    last_login_at: string | null;
    online_duration_seconds: number | null;
}

/**
 * GET /api/admin/devices
 * Get status of all booth devices (admin only)
 * 
 * Query params:
 * - organization_id: Filter by organization (optional)
 * - status: Filter by 'online' | 'offline' | 'all' (default: 'all')
 */
export async function GET(request: NextRequest) {
    try {
        // Require admin authentication (cookie or API key)
        const authError = await requireAuthWithApiKey(request);
        if (authError) {
            return authError;
        }

        let organizationId: string | null = null;
        let statusFilter = 'all';

        try {
            const { searchParams } = new URL(request.url);
            organizationId = searchParams.get('organization_id');
            statusFilter = searchParams.get('status') || 'all';
        } catch (urlError) {
            // In Tauri dev mode, request.url might be malformed
            // Fall back to default values
            console.warn('Failed to parse URL search params:', urlError);
        }

        // Build query - select all fields to handle potentially missing columns
        let query = supabase
            .from('booths')
            .select('*')
            .eq('status', 'active')
            .order('name');

        // Apply organization filter if provided
        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }

        const { data: booths, error } = await query;

        if (error) {
            console.error('Device query error:', error);
            return NextResponse.json(
                { error: 'Failed to fetch devices' },
                { status: 500 }
            );
        }

        const now = Date.now();

        // Process booths into device status
        const devices: DeviceStatus[] = (booths || []).map((booth) => {
            let status: 'online' | 'offline' | 'never_connected';
            let onlineDuration: number | null = null;

            if (!booth.device_token) {
                // Never logged in
                status = 'never_connected';
            } else if (!booth.last_heartbeat) {
                // Has logged in but no heartbeat yet
                status = 'offline';
            } else {
                const lastHeartbeat = new Date(booth.last_heartbeat).getTime();
                const timeSinceHeartbeat = now - lastHeartbeat;

                if (timeSinceHeartbeat <= OFFLINE_THRESHOLD_MS) {
                    status = 'online';
                    // Calculate online duration from last login
                    if (booth.last_login_at) {
                        const loginTime = new Date(booth.last_login_at).getTime();
                        onlineDuration = Math.floor((now - loginTime) / 1000);
                    }
                } else {
                    status = 'offline';
                }
            }

            return {
                booth_id: booth.id,
                booth_name: booth.name,
                booth_code: booth.code,
                location: booth.location,
                organization_id: booth.organization_id,
                device_name: booth.device_name,
                device_ip: booth.device_ip,
                status,
                last_heartbeat: booth.last_heartbeat,
                last_login_at: booth.last_login_at,
                online_duration_seconds: onlineDuration,
            };
        });

        // Apply status filter
        let filteredDevices = devices;
        if (statusFilter === 'online') {
            filteredDevices = devices.filter(d => d.status === 'online');
        } else if (statusFilter === 'offline') {
            filteredDevices = devices.filter(d => d.status === 'offline' || d.status === 'never_connected');
        }

        // Calculate summary stats
        const summary = {
            total: devices.length,
            online: devices.filter(d => d.status === 'online').length,
            offline: devices.filter(d => d.status === 'offline').length,
            never_connected: devices.filter(d => d.status === 'never_connected').length,
        };

        return NextResponse.json({
            success: true,
            summary,
            devices: filteredDevices,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Device status error:', error);
        return NextResponse.json(
            { error: 'Failed to get device status' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/admin/devices/[boothId]
 * Get detailed status for a specific booth
 */
