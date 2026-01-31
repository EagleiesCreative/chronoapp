import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBoothByCode } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
    signBoothToken,
    setBoothSession,
    getBoothSession,
    clearBoothSession,
    checkRateLimit,
    resetRateLimit,
    generateDeviceToken,
    parseDeviceName,
} from '@/lib/booth-auth';

// Validation schema for login
const loginSchema = z.object({
    code: z.string()
        .min(9, 'Booth code must be 9 characters')
        .max(9, 'Booth code must be 9 characters')
        .regex(/^[A-Z]{4}-[0-9]{4}$/, 'Invalid booth code format'),
});

/**
 * POST /api/auth/booth-login
 * Authenticate a booth with PIN code
 * Enforces single-device login - new login invalidates previous device
 */
export async function POST(request: NextRequest) {
    try {
        // Get client IP for rate limiting
        const ip = request.headers.get('x-forwarded-for') ||
            request.headers.get('x-real-ip') ||
            'unknown';

        // Check rate limit
        const rateLimit = checkRateLimit(ip);
        if (!rateLimit.allowed) {
            return NextResponse.json(
                {
                    error: 'Too many login attempts. Please try again in 1 minute.',
                    retryAfter: 60
                },
                { status: 429 }
            );
        }

        const body = await request.json();

        // Validate input
        const validation = loginSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const { code } = validation.data;

        // Look up booth by code
        const booth = await getBoothByCode(code.toUpperCase());

        if (!booth) {
            return NextResponse.json(
                {
                    error: 'Invalid booth code',
                    remainingAttempts: rateLimit.remainingAttempts
                },
                { status: 401 }
            );
        }

        // Reset rate limit on success
        resetRateLimit(ip);

        // Generate unique device token for this login session
        const deviceToken = generateDeviceToken();

        // Parse device name
        const userAgent = request.headers.get('user-agent') || 'Unknown Device';
        const deviceName = parseDeviceName(userAgent);

        // Update booth with new device token (invalidates any previous session)
        const { error: updateError } = await supabaseAdmin
            .from('booths')
            .update({
                device_token: deviceToken,
                last_login_at: new Date().toISOString(),
                device_ip: ip,
                device_name: deviceName,
                last_heartbeat: new Date().toISOString(), // Optional: treat login as first heartbeat
            })
            .eq('id', booth.id);

        if (updateError) {
            console.error('Failed to update device token:', updateError);
            return NextResponse.json(
                { error: 'Login failed' },
                { status: 500 }
            );
        }

        // Generate JWT with device token
        const token = await signBoothToken({
            booth_id: booth.id,
            booth_name: booth.name,
            organization_id: booth.organization_id,
            device_token: deviceToken,
        });

        // Set HttpOnly cookie
        await setBoothSession(token);

        return NextResponse.json({
            success: true,
            booth: {
                id: booth.id,
                name: booth.name,
                location: booth.location,
                price: booth.price,
            },
        });
    } catch (error) {
        console.error('Booth login error:', error);
        return NextResponse.json(
            { error: 'Login failed' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/auth/booth-login
 * Check current booth session and validate device token
 */
export async function GET() {
    try {
        const session = await getBoothSession();

        if (!session) {
            return NextResponse.json({ authenticated: false });
        }

        // Verify device token is still valid (not logged in elsewhere)
        const { data: booth, error } = await supabaseAdmin
            .from('booths')
            .select('device_token')
            .eq('id', session.booth_id)
            .single();

        if (error || !booth) {
            await clearBoothSession();
            return NextResponse.json({ authenticated: false });
        }

        // Check if this device's token matches the current active token
        if (booth.device_token !== session.device_token) {
            // Another device has logged in - invalidate this session
            await clearBoothSession();
            return NextResponse.json({
                authenticated: false,
                reason: 'logged_in_elsewhere',
                message: 'This session has been invalidated. The booth code was used to login on another device.',
            });
        }

        return NextResponse.json({
            authenticated: true,
            booth: {
                id: session.booth_id,
                name: session.booth_name,
                organization_id: session.organization_id,
            },
        });
    } catch (error) {
        console.error('Session check error:', error);
        return NextResponse.json({ authenticated: false });
    }
}

/**
 * DELETE /api/auth/booth-login
 * Logout booth session and clear device token
 */
export async function DELETE() {
    try {
        const session = await getBoothSession();

        // Clear device token in database if we have a valid session
        if (session) {
            await supabaseAdmin
                .from('booths')
                .update({ device_token: null })
                .eq('id', session.booth_id);
        }

        await clearBoothSession();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Logout error:', error);
        return NextResponse.json(
            { error: 'Logout failed' },
            { status: 500 }
        );
    }
}

