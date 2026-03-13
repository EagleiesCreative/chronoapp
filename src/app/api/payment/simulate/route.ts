import { NextRequest, NextResponse } from 'next/server';
import { getPaymentBySessionId, updatePaymentStatus, updateSession } from '@/lib/supabase';
import { checkSession } from '@/lib/admin-auth';

/**
 * Simulate payment endpoint for testing purposes
 * This bypasses Xendit and directly marks a payment as paid
 * 
 * SECURITY: Disabled in production. Requires admin auth in development.
 */
export async function POST(request: NextRequest) {
    try {
        // Block in production
        if (process.env.NODE_ENV === 'production') {
            return NextResponse.json(
                { error: 'Payment simulation is not available in production' },
                { status: 404 }
            );
        }

        // Require admin authentication even in development
        const isAdmin = await checkSession(request);
        if (!isAdmin) {
            return NextResponse.json(
                { error: 'Admin authentication required' },
                { status: 401 }
            );
        }

        const { sessionId } = await request.json();

        if (!sessionId) {
            return NextResponse.json(
                { error: 'sessionId is required' },
                { status: 400 }
            );
        }

        // Get payment from database
        const payment = await getPaymentBySessionId(sessionId);

        if (!payment) {
            return NextResponse.json(
                { error: 'Payment not found' },
                { status: 404 }
            );
        }

        // Simulate payment success
        await updatePaymentStatus(payment.xendit_invoice_id, 'paid');
        await updateSession(sessionId, { status: 'paid' });

        return NextResponse.json({
            success: true,
            status: 'paid',
            message: 'Payment simulated successfully',
        });
    } catch (error) {
        console.error('Simulate payment error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to simulate payment' },
            { status: 500 }
        );
    }
}
