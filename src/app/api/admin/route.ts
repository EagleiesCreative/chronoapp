import { NextRequest, NextResponse } from 'next/server';
import { createSession, clearSession, checkSession } from '@/lib/admin-auth';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { timingSafeEqual } from 'crypto';
import { checkRateLimitRedis } from '@/lib/redis';

// POST - Login with PIN
export async function POST(request: NextRequest) {
    try {
        const { pin } = await request.json();

        if (!pin || typeof pin !== 'string') {
            return NextResponse.json(
                { error: 'PIN is required' },
                { status: 400 }
            );
        }

        // Get client IP for rate limiting
        const ip = request.headers.get('x-forwarded-for') ||
            request.headers.get('x-real-ip') ||
            'unknown';

        // Check rate limit (Max 5 attempts per minute for Admin PIN)
        const rateLimit = await checkRateLimitRedis(`admin_login:${ip}`, 5, 60);
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: 'Too many login attempts. Please try again in 1 minute.' },
                { status: 429 }
            );
        }

        // Get current booth session
        const session = await getBoothFromRequest(request);
        if (!session) {
            return NextResponse.json(
                { error: 'Booth not logged in' },
                { status: 401 }
            );
        }

        // Get booth's app_pin from database
        const { data: booth, error } = await supabaseAdmin
            .from('booths')
            .select('app_pin')
            .eq('id', session.booth_id)
            .single();

        if (error || !booth) {
            console.error('Failed to fetch booth:', error);
            return NextResponse.json(
                { error: 'Failed to verify PIN' },
                { status: 500 }
            );
        }

        // Verify PIN against booth's app_pin in constant time
        const pinBuffer = Buffer.from(pin);
        const storedPinBuffer = Buffer.from(booth.app_pin || '');
        const isMatch = pinBuffer.length === storedPinBuffer.length && 
                        timingSafeEqual(pinBuffer, storedPinBuffer);

        if (!booth.app_pin || !isMatch) {
            return NextResponse.json(
                { error: 'Invalid PIN' },
                { status: 401 }
            );
        }

        const token = await createSession();

        return NextResponse.json({ success: true, token });
    } catch (error) {
        console.error('Admin login error:', error);
        return NextResponse.json(
            { error: 'Login failed' },
            { status: 500 }
        );
    }
}

// DELETE - Logout
export async function DELETE() {
    try {
        await clearSession();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Admin logout error:', error);
        return NextResponse.json(
            { error: 'Logout failed' },
            { status: 500 }
        );
    }
}

// GET - Check session status
export async function GET(request: NextRequest) {
    try {
        const isAuthenticated = await checkSession(request);
        return NextResponse.json({ authenticated: isAuthenticated });
    } catch (error) {
        console.error('Admin session check error:', error);
        return NextResponse.json(
            { error: 'Session check failed' },
            { status: 500 }
        );
    }
}
