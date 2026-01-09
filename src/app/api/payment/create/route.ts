import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createInvoice } from '@/lib/xendit';
import { supabase } from '@/lib/supabase';
import { createPayment, createSession, updateSession, getBoothById } from '@/lib/supabase';
import { getBoothFromRequest } from '@/lib/booth-auth';

// Input validation schema
const createPaymentSchema = z.object({
    frameId: z.string().uuid('Invalid frame ID'),
    voucherCode: z.string().optional(),
});

/**
 * POST /api/payment/create
 * Create a new payment invoice
 * 
 * SECURITY: Price is fetched server-side from booth settings
 * Client-sent prices are IGNORED for security
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
            return NextResponse.json(
                { error: 'Booth not found' },
                { status: 404 }
            );
        }

        let amount = booth.price;
        let appliedVoucher = null;
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
                // Validate voucher
                const isActive = voucher.is_active;
                const isNotExpired = !voucher.expires_at || new Date(voucher.expires_at) > new Date();
                const hasUsesLeft = voucher.max_uses === null || voucher.used_count < voucher.max_uses;

                if (isActive && isNotExpired && hasUsesLeft) {
                    // Calculate discount
                    if (voucher.discount_type === 'fixed') {
                        discountAmount = Math.min(voucher.discount_amount, amount);
                    } else if (voucher.discount_type === 'percentage') {
                        discountAmount = Math.floor((amount * voucher.discount_amount) / 100);
                    }

                    amount = Math.max(0, amount - discountAmount);
                    appliedVoucher = {
                        id: voucher.id,
                        code: voucher.code,
                        discount_amount: discountAmount,
                        discount_type: voucher.discount_type,
                    };

                    // Increment used_count
                    await supabase
                        .from('vouchers')
                        .update({ used_count: voucher.used_count + 1 })
                        .eq('id', voucher.id);
                }
            }
        }

        // Handle free session (amount = 0)
        if (amount <= 0 && appliedVoucher) {
            // Create session without payment for free vouchers
            const session = await createSession(frameId, booth.id);

            return NextResponse.json({
                success: true,
                sessionId: session.id,
                paymentId: null,
                invoiceId: null,
                invoiceUrl: null,
                expiryDate: null,
                amount: 0,
                originalAmount: booth.price,
                discountAmount: discountAmount,
                appliedVoucher: appliedVoucher,
                isFree: true,
            });
        }

        if (!amount || amount <= 0) {
            return NextResponse.json(
                { error: 'Booth price not configured' },
                { status: 400 }
            );
        }

        // Create session in database with booth_id
        const session = await createSession(frameId, booth.id);

        // Generate external ID for Xendit (includes booth_id for revenue tracking)
        const externalId = `chrono_${booth.id}_${session.id}_${Date.now()}`;

        // Create invoice with Xendit
        const invoice = await createInvoice(
            externalId,
            amount,
            `ChronoSnap - ${booth.name}`,
            900 // 15 minutes
        );

        // Store payment in database with booth_id
        const payment = await createPayment(
            session.id,
            invoice.id,
            null,
            amount,
            booth.id
        );

        // Update session with payment ID
        await updateSession(session.id, { payment_id: payment.id });

        return NextResponse.json({
            success: true,
            sessionId: session.id,
            paymentId: payment.id,
            invoiceId: invoice.id,
            invoiceUrl: invoice.invoice_url,
            expiryDate: invoice.expiry_date,
            amount: amount,
            originalAmount: booth.price,
            discountAmount: discountAmount,
            appliedVoucher: appliedVoucher,
            isFree: false,
        });
    } catch (error) {
        console.error('Payment creation error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to create payment' },
            { status: 500 }
        );
    }
}
