import { NextRequest, NextResponse } from 'next/server';
import { verifyDokuWebhookSignature } from '@/lib/doku';
import { updatePaymentStatus, updateSession, supabase } from '@/lib/supabase';

/**
 * POST /api/payment/webhook-doku
 *
 * DOKU sends a notification when a QRIS payment is completed/expired/failed.
 * Register this URL in the DOKU Merchant Dashboard as your callback URL.
 *
 * DOKU notification body (SNAP BI v1.0 format):
 * {
 *   originalPartnerReferenceNo: "chrono_doku_<boothId>_<sessionId>_<ts>",
 *   originalReferenceNo: "<dokuTransactionId>",
 *   latestTransactionStatus: "00" | "03" | "07",
 *   amount: { value: "15000.00", currency: "IDR" },
 *   ...
 * }
 *
 * Status codes:
 *   "00" → SUCCESS / PAID
 *   "03" → PENDING
 *   "07" → FAILED
 *   "14" → EXPIRED
 */
export async function POST(request: NextRequest) {
    try {
        // Read raw body for signature verification
        const rawBody = await request.text();
        const signature = request.headers.get('x-signature') ?? '';

        // Verify DOKU webhook signature (HMAC-SHA512)
        if (!verifyDokuWebhookSignature(rawBody, signature)) {
            console.warn('[webhook-doku] Invalid signature received');
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        const body = JSON.parse(rawBody);

        const {
            originalPartnerReferenceNo,  // Our externalId: chrono_doku_<booth>_<session>_<ts>
            latestTransactionStatus,
            amount,
        } = body;

        if (!originalPartnerReferenceNo || !latestTransactionStatus) {
            return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
        }

        // Map DOKU status codes → internal status
        let paymentStatus: 'pending' | 'paid' | 'expired' | 'failed' = 'pending';
        if (latestTransactionStatus === '00') {
            paymentStatus = 'paid';
        } else if (latestTransactionStatus === '14') {
            paymentStatus = 'expired';
        } else if (latestTransactionStatus === '07' || latestTransactionStatus === '06') {
            paymentStatus = 'failed';
        }

        // Look up the payment by our external reference ID
        const { data: payment } = await supabase
            .from('payments')
            .select('id, session_id, status, xendit_invoice_id, payment_type')
            .eq('xendit_invoice_id', originalPartnerReferenceNo)
            .single();

        if (!payment) {
            console.error('[webhook-doku] Payment not found for ref:', originalPartnerReferenceNo);
            // Return 200 so DOKU doesn't retry (we just don't have this payment)
            return NextResponse.json({ success: true });
        }

        // Skip if status hasn't changed (idempotency)
        if (payment.status === paymentStatus) {
            return NextResponse.json({ success: true });
        }

        // Update payment status
        await updatePaymentStatus(payment.xendit_invoice_id, paymentStatus);

        // Update session to paid if payment succeeded. Extra-print top-ups are
        // skipped — that session is already finished and must stay that way.
        if (paymentStatus === 'paid' && payment.session_id && payment.payment_type !== 'extra_print') {
            await updateSession(payment.session_id, { status: 'paid' });
        }

        console.log(`[webhook-doku] ${originalPartnerReferenceNo} → ${paymentStatus}`);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('/api/payment/webhook-doku POST error:', error);
        // Always return 200 to prevent DOKU retry storms on our errors
        return NextResponse.json({ success: true });
    }
}
