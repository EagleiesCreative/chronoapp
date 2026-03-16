import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBoothFromRequest, parseDeviceName } from '@/lib/booth-auth';

type HeartbeatVitals = {
    status?: 'online' | 'offline';
    camera_battery?: number | null;
    printer_status?: 'ready' | 'warning' | 'error' | 'unknown';
    prints_remaining?: number | null;
};

/**
 * POST /api/booth/heartbeat
 * Called periodically by booth to report online status
 * Updates device info (IP, name, heartbeat timestamp)
 */
export async function POST(request: NextRequest) {
    try {
        const booth = await getBoothFromRequest(request);

        if (!booth) {
            return NextResponse.json(
                { error: 'Booth authentication required' },
                { status: 401 }
            );
        }

        // Get device info from request
        const ip = request.headers.get('x-forwarded-for') ||
            request.headers.get('x-real-ip') ||
            'unknown';

        const userAgent = request.headers.get('user-agent') || 'Unknown Device';

        // Parse device name from user agent or use custom name from body
        let deviceName = 'Unknown Device';
        let vitals: HeartbeatVitals | null = null;
        try {
            const body = await request.json().catch(() => ({}));
            deviceName = body.deviceName || parseDeviceName(userAgent);
            vitals = body.vitals || null;
        } catch {
            deviceName = parseDeviceName(userAgent);
        }

        // Update booth with heartbeat and device info
        // Use supabaseAdmin to bypass RLS restrictions since booth context might not have update permissions
        const { error } = await supabaseAdmin
            .from('booths')
            .update({
                device_ip: ip,
                device_name: deviceName,
                last_heartbeat: new Date().toISOString(),
                booth_status: vitals?.status || 'online',
                camera_battery: typeof vitals?.camera_battery === 'number' ? vitals.camera_battery : null,
                printer_status: vitals?.printer_status || 'unknown',
                prints_remaining: typeof vitals?.prints_remaining === 'number' ? vitals.prints_remaining : null,
                telemetry_updated_at: new Date().toISOString(),
            })
            .eq('id', booth.booth_id);

        if (error) {
            console.error('Heartbeat update error:', error);
            return NextResponse.json(
                { error: 'Failed to update heartbeat' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Heartbeat error:', error);
        return NextResponse.json(
            { error: 'Heartbeat failed' },
            { status: 500 }
        );
    }
}
