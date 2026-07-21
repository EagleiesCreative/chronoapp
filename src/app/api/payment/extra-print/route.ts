import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
    supabase,
    getBoothById,
    getActiveBoothSession,
    updatePaymentStatus,
    getPaymentById,
    DEFAULT_EXTRA_PRINT_PRICE,
} from '@/lib/supabase';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { resolvePaymentProvider, createQRISPayment, checkQRISStatus, PaymentProvider } from '@/lib/payment-gateway';

const createExtraPrintSchema = z.object({
    sessionId: z.string().uuid('Invalid session ID'),
});

/**
 * POST /api/payment/extra-print
 * Create a QRIS payment for one additional print of an already-finished session.
 *
 * SECURITY: the price comes from booth settings server-side; the client never
 * sends an amount. The session must belong to the authenticated booth.
 */
export async function POST(request: NextRequest) {
    try {
        const boothSession = await getBoothFromRequest(request);
        if (!boothSession) {
            return NextResponse.json({ error: 'Booth authentication required' }, { status: 401 });
        }

        const body = await request.json();
        const validation = createExtraPrintSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
        }

        const { sessionId } = validation.data;

        const booth = await getBoothById(boothSession.booth_id);
        if (!booth) {
            return NextResponse.json({ error: 'Booth not found' }, { status: 404 });
        }

        if (booth.extra_print_enabled === false) {
            return NextResponse.json({ error: 'Extra prints are disabled for this booth' }, { status: 403 });
        }

        // The session must belong to this booth — otherwise a booth could bill
        // against someone else's session.
        const { data: session } = await supabase
            .from('sessions')
            .select('id, booth_id')
            .eq('id', sessionId)
            .single();

        if (!session || session.booth_id !== booth.id) {
            return NextResponse.json({ error: 'Session not found for this booth' }, { status: 404 });
        }

        const activeBoothSession = await getActiveBoothSession(booth.id);
        const paymentBypass = activeBoothSession?.payment_bypass ?? booth.payment_bypass;
        const amount = booth.extra_print_price ?? DEFAULT_EXTRA_PRINT_PRICE;

        // Free booths print extra copies without a QR.
        if (paymentBypass) {
            return NextResponse.json({
                success: true,
                isFree: true,
                paymentId: null,
                qrString: null,
                amount: 0,
                originalAmount: amount,
            });
        }

        if (!amount || amount <= 0) {
            return NextResponse.json({ error: 'Extra print price not configured' }, { status: 400 });
        }

        const provider = await resolvePaymentProvider(booth.organization_id);
        const externalId = `chrono_reprint_${provider}_${booth.id}_${sessionId}_${Date.now()}`;

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://chrono-snap.onrender.com';
        const callbackUrl = provider === 'doku'
            ? `${appUrl}/api/payment/webhook-doku`
            : `${appUrl}/api/payment/webhook`;

        const qris = await createQRISPayment(provider, externalId, amount, callbackUrl);

        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .insert({
                session_id: sessionId,
                booth_id: booth.id,
                xendit_invoice_id: qris.id,
                xendit_qr_string: qris.qrString,
                amount,
                status: 'pending',
                payment_type: 'extra_print',
                provider,
            })
            .select()
            .single();

        if (paymentError || !payment) {
            throw paymentError || new Error('Failed to record extra print payment');
        }

        return NextResponse.json({
            success: true,
            isFree: false,
            paymentId: payment.id,
            invoiceId: qris.id,
            qrString: qris.qrString,
            expiryDate: qris.expiresAt ?? null,
            amount,
            provider,
        });
    } catch (error) {
        console.error('/api/payment/extra-print POST error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to create extra print payment' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/payment/extra-print?paymentId=...
 * Poll the status of a single extra-print payment.
 *
 * Deliberately keyed by paymentId rather than sessionId: a session can have
 * several extra-print payments, and /api/payment/status only ever reports the
 * original booking payment.
 */
export async function GET(request: NextRequest) {
    try {
        const boothSession = await getBoothFromRequest(request);
        if (!boothSession) {
            return NextResponse.json({ error: 'Booth authentication required' }, { status: 401 });
        }

        let paymentId: string | null = null;
        try {
            const { searchParams } = new URL(request.url);
            paymentId = searchParams.get('paymentId');
        } catch (urlError) {
            // In Tauri dev mode request.url can be malformed.
            console.warn('Failed to parse URL search params:', urlError);
        }

        if (!paymentId) {
            return NextResponse.json({ error: 'paymentId is required' }, { status: 400 });
        }

        const payment = await getPaymentById(paymentId);
        if (!payment || payment.payment_type !== 'extra_print') {
            return NextResponse.json({ error: 'Extra print payment not found' }, { status: 404 });
        }

        const { data: paymentRecord } = await supabase
            .from('payments')
            .select('provider, amount, booth_id')
            .eq('id', payment.id)
            .single();

        if (paymentRecord?.booth_id && paymentRecord.booth_id !== boothSession.booth_id) {
            return NextResponse.json({ error: 'Unauthorized for this payment' }, { status: 403 });
        }

        // Already settled (e.g. by webhook) — no need to hit the provider again.
        if (payment.status === 'paid') {
            return NextResponse.json({ success: true, status: 'paid', paymentId: payment.id, amount: payment.amount });
        }

        const provider = (paymentRecord?.provider ?? 'xendit') as PaymentProvider;
        const amount = paymentRecord?.amount ?? payment.amount;

        const { status } = await checkQRISStatus(provider, payment.xendit_invoice_id, amount);

        if (status !== payment.status) {
            await updatePaymentStatus(payment.xendit_invoice_id, status);
        }

        return NextResponse.json({
            success: true,
            status,
            paymentId: payment.id,
            invoiceId: payment.xendit_invoice_id,
            amount,
            provider,
        });
    } catch (error) {
        console.error('/api/payment/extra-print GET error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to check extra print payment' },
            { status: 500 }
        );
    }
}
