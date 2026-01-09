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
            // Get session ID from external_id (format: chrono_{sessionId}_{timestamp})
            const sessionId = external_id.split('_')[1];

            if (sessionId) {
                await updateSession(sessionId, { status: 'paid' });
            }
        }

        console.log(`Webhook received: Invoice ${id} status updated to ${paymentStatus}`);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Webhook processing failed' },
            { status: 500 }
        );
    }
}
