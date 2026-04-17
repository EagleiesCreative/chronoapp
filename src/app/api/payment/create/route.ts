import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { createPayment, createSession, updateSession, getBoothById, getActiveBoothSession } from '@/lib/supabase';
import { getBoothFromRequest } from '@/lib/booth-auth';
import { resolvePaymentProvider, createQRISPayment } from '@/lib/payment-gateway';

// Input validation schema
const createPaymentSchema = z.object({
    frameId: z.string().uuid('Invalid frame ID'),
    voucherCode: z.string().optional(),
});

/**
 * POST /api/payment/create
 * Create a new payment invoice — provider is resolved dynamically from the
 * booth organization's admin user `payment_integration` setting.
 *
 * SECURITY: Price is fetched server-side from booth settings.
 * Client-sent prices are IGNORED.
 */
export async function POST(request: NextRequest) {
    try {
        // Get authenticated booth
        const boothSession = await getBoothFromRequest(request);
        if (!boothSession) {
            return NextResponse.json(
                { error: 'Booth authentication required' },
                { status: 401 }
            );
        }

        const body = await request.json();

        // Validate input
        const validation = createPaymentSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const { frameId, voucherCode } = validation.data;

        // SECURITY: Fetch price from booth settings (server-side authority)
        const booth = await getBoothById(boothSession.booth_id);
        if (!booth) {
            return NextResponse.json({ error: 'Booth not found' }, { status: 404 });
        }

        // Fetch active booth session for settings
        const activeBoothSession = await getActiveBoothSession(booth.id);
        const effectivePrice         = activeBoothSession?.price ?? booth.price;
        const effectivePaymentBypass = activeBoothSession?.payment_bypass ?? booth.payment_bypass;
        const boothSessionId         = activeBoothSession?.id;

        // Bypass payment if enabled
        if (effectivePaymentBypass) {
            const session = await createSession(frameId, booth.id, boothSessionId);
            return NextResponse.json({
                success: true,
                sessionId: session.id,
                paymentId: null,
                invoiceId: null,
                invoiceUrl: null,
                expiryDate: null,
                amount: 0,
                originalAmount: effectivePrice,
                discountAmount: effectivePrice,
                appliedVoucher: null,
                isFree: true,
                isBypassed: true,
            });
        }

        let amount        = effectivePrice;
        let appliedVoucher: null | object = null;
        let discountAmount = 0;

        // Validate and apply voucher if provided
        if (voucherCode) {
            const normalizedCode = voucherCode.trim().toUpperCase();

            const { data: voucher, error: voucherError } = await supabase
                .from('vouchers')
                .select('*')
                .eq('booth_id', booth.id)
                .eq('code', normalizedCode)
                .single();

            if (voucher && !voucherError) {
                const isActive    = voucher.is_active;
                const isNotExpired = !voucher.expires_at || new Date(voucher.expires_at) > new Date();
                const hasUsesLeft  = voucher.max_uses === null || voucher.used_count < voucher.max_uses;

                if (isActive && isNotExpired && hasUsesLeft) {
                    if (voucher.discount_type === 'fixed') {
                        discountAmount = Math.min(voucher.discount_amount, amount);
                    } else if (voucher.discount_type === 'percentage') {
                        discountAmount = Math.floor((amount * voucher.discount_amount) / 100);
                    }

                    amount = Math.max(0, amount - discountAmount);
                    appliedVoucher = {
                        id:             voucher.id,
                        code:           voucher.code,
                        discount_amount: discountAmount,
                        discount_type:  voucher.discount_type,
                    };

                    await supabase
                        .from('vouchers')
                        .update({ used_count: voucher.used_count + 1 })
                        .eq('id', voucher.id);
                }
            }
        }

        // Handle free session (full voucher discount)
        if (amount <= 0 && appliedVoucher) {
            const session = await createSession(frameId, booth.id, boothSessionId);
            return NextResponse.json({
                success: true,
                sessionId: session.id,
                paymentId: null,
                invoiceId: null,
                invoiceUrl: null,
                expiryDate: null,
                amount: 0,
                originalAmount: effectivePrice,
                discountAmount,
                appliedVoucher,
                isFree: true,
            });
        }

        if (!amount || amount <= 0) {
            return NextResponse.json({ error: 'Booth price not configured' }, { status: 400 });
        }

        // ── Resolve payment provider ──────────────────────────────────────────
        const provider = await resolvePaymentProvider(booth.organization_id);

        // Create DB session first
        const session = await createSession(frameId, booth.id, boothSessionId);

        // External ID includes provider prefix for easy identification in webhooks
        const externalId = `chrono_${provider}_${booth.id}_${session.id}_${Date.now()}`;

        const appUrl     = process.env.NEXT_PUBLIC_APP_URL || 'https://chrono-snap.onrender.com';
        const callbackUrl = provider === 'doku'
            ? `${appUrl}/api/payment/webhook-doku`
            : `${appUrl}/api/payment/webhook`;

        // Create QRIS via the resolved provider
        const qris = await createQRISPayment(provider, externalId, amount, callbackUrl);

        // Store payment in DB (xendit_invoice_id field is reused as generic invoice_id)
        const payment = await createPayment(
            session.id,
            qris.id,
            null,
            amount,
            booth.id,
        );

        // Persist provider alongside the payment record
        await supabase
            .from('payments')
            .update({ provider })
            .eq('id', payment.id);

        // Link session ↔ payment
        await updateSession(session.id, { payment_id: payment.id });

        return NextResponse.json({
            success: true,
            sessionId: session.id,
            paymentId: payment.id,
            invoiceId: qris.id,
            invoiceUrl: qris.qrString,   // Raw QRIS string rendered into QR image client-side
            expiryDate: qris.expiresAt ?? null,
            amount,
            originalAmount: effectivePrice,
            discountAmount,
            appliedVoucher,
            isFree: false,
            provider,
        });
    } catch (error) {
        console.error('/api/payment/create POST error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to create payment' },
            { status: 500 }
        );
    }
}
