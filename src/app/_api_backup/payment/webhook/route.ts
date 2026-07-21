import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookToken } from '@/lib/xendit';
import { updatePaymentStatus, updateSession, supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
    try {
        // Get webhook verification token from header
        const webhookToken = request.headers.get('x-callback-token');

        if (!webhookToken || !verifyWebhookToken(webhookToken)) {
            return NextResponse.json(
                { error: 'Invalid webhook token' },
                { status: 401 }
            );
        }

        const body = await request.json();

        // Handle invoice/QR payment callback
        const { id, external_id, status } = body;

        if (!id || !external_id) {
            return NextResponse.json(
                { error: 'Invalid webhook payload' },
                { status: 400 }
            );
        }

        // Map Xendit status
        let paymentStatus: 'pending' | 'paid' | 'expired' | 'failed' = 'pending';
        if (status === 'PAID' || status === 'SETTLED') {
            paymentStatus = 'paid';
        } else if (status === 'EXPIRED') {
            paymentStatus = 'expired';
        } else if (status === 'FAILED') {
            paymentStatus = 'failed';
        }

        // Update payment status
        const payment = await updatePaymentStatus(id, paymentStatus);

        if (payment && paymentStatus === 'paid') {
            // Use the payment row's own session_id rather than parsing external_id:
            // the external_id layout varies by provider and payment type.
            // Extra-print top-ups must never rewrite the session status — the
            // session is already completed by the time one is bought.
            if (payment.session_id && payment.payment_type !== 'extra_print') {
                await updateSession(payment.session_id, { status: 'paid' });
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Webhook processing failed' },
            { status: 500 }
        );
    }
}
