import { NextRequest, NextResponse } from 'next/server';
import { createSession, clearSession, checkSession } from '@/lib/admin-auth';
import { getBoothSession } from '@/lib/booth-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

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

        // Get current booth session
        const session = await getBoothSession();
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

        // Verify PIN against booth's app_pin
        if (!booth.app_pin || pin !== booth.app_pin) {
            return NextResponse.json(
                { error: 'Invalid PIN' },
                { status: 401 }
            );
        }

        await createSession();

        return NextResponse.json({ success: true });
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
export async function GET() {
    try {
        const isAuthenticated = await checkSession();
        return NextResponse.json({ authenticated: isAuthenticated });
    } catch (error) {
        console.error('Admin session check error:', error);
        return NextResponse.json(
            { error: 'Session check failed' },
            { status: 500 }
        );
    }
}
