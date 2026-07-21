import { NextRequest, NextResponse } from 'next/server';
import { getPaymentBySessionId, updatePaymentStatus, updateSession } from '@/lib/supabase';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { checkQRISStatus, PaymentProvider } from '@/lib/payment-gateway';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
    try {
        // Require booth authentication
        const boothSession = await getBoothFromRequest(request);
        if (!boothSession) {
            return NextResponse.json(
                { error: 'Booth authentication required' },
                { status: 401 }
            );
        }

        let sessionId: string | null = null;
        try {
            const { searchParams } = new URL(request.url);
            sessionId = searchParams.get('sessionId');
        } catch (urlError) {
            // In Tauri dev mode, request.url might be malformed
            console.warn('Failed to parse URL search params:', urlError);
        }

        if (!sessionId) {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }

        // Get payment from database
        const payment = await getPaymentBySessionId(sessionId);
        if (!payment) {
            return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
        }

        // Read the payment provider stored at creation time
        const { data: paymentRecord } = await supabase
            .from('payments')
            .select('provider, amount')
            .eq('id', payment.id)
            .single();

        const provider = (paymentRecord?.provider ?? 'xendit') as PaymentProvider;
        const amount   = paymentRecord?.amount ?? payment.amount;

        // Check status with the correct provider
        const { status } = await checkQRISStatus(provider, payment.xendit_invoice_id, amount);

        // Update payment status if changed
        if (status !== payment.status) {
            await updatePaymentStatus(payment.xendit_invoice_id, status);

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
            provider,
        });
    } catch (error) {
        console.error('/api/payment/status GET error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to check payment status' },
            { status: 500 }
        );
    }
}
