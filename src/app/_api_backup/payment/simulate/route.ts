import { NextRequest, NextResponse } from 'next/server';
import { getPaymentBySessionId, updatePaymentStatus, updateSession } from '@/lib/supabase';

/**
 * Simulate payment endpoint for testing purposes
 * This bypasses Xendit and directly marks a payment as paid
 */
export async function POST(request: NextRequest) {
    try {
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
