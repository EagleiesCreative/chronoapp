import { NextRequest, NextResponse } from 'next/server';
import { getInvoice } from '@/lib/xendit';
import { getPaymentBySessionId, updatePaymentStatus, updateSession } from '@/lib/supabase';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');

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

        // Check status with Xendit
        const invoice = await getInvoice(payment.xendit_invoice_id);

        // Map Xendit status to our status
        let status: 'pending' | 'paid' | 'expired' | 'failed' = 'pending';
        if (invoice.status === 'PAID' || invoice.status === 'SETTLED') {
            status = 'paid';
        } else if (invoice.status === 'EXPIRED') {
            status = 'expired';
        } else if (invoice.status === 'FAILED') {
            status = 'failed';
        }

        // Update payment status if changed
        if (status !== payment.status) {
            await updatePaymentStatus(payment.xendit_invoice_id, status);

            // Update session status if paid
            if (status === 'paid') {
                await updateSession(sessionId, { status: 'paid' });
            }
        }

        return NextResponse.json({
            success: true,
            status,
            paymentId: payment.id,
            invoiceId: payment.xendit_invoice_id,
            amount: payment.amount,
        });
    } catch (error) {
        console.error('Payment status check error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to check payment status' },
            { status: 500 }
        );
    }
}
