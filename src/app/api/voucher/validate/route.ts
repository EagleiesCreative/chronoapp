import { NextRequest, NextResponse } from 'next/server';
import { getBoothById } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBoothFromRequest } from '@/lib/booth-auth';

export async function POST(request: NextRequest) {
    try {
        // Get booth from session
        const boothData = await getBoothFromRequest(request);
        if (!boothData) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Fetch full booth data including price
        const booth = await getBoothById(boothData.booth_id);
        if (!booth) {
            return NextResponse.json(
                { success: false, error: 'Booth not found' },
                { status: 404 }
            );
        }

        const body = await request.json();
        const { code } = body;

        if (!code || typeof code !== 'string') {
            return NextResponse.json(
                { success: false, error: 'Voucher code is required' },
                { status: 400 }
            );
        }

        const normalizedCode = code.trim();

        console.log('Voucher validation - booth_id:', booth.id, 'code:', normalizedCode);

        // Fetch voucher from database (case-insensitive)
        const { data: voucher, error: voucherError } = await supabaseAdmin
            .from('vouchers')
            .select('*')
            .eq('booth_id', booth.id)
            .ilike('code', normalizedCode)
            .single();

        console.log('Voucher query result:', { voucher, error: voucherError });

        if (voucherError || !voucher) {
            return NextResponse.json({
                success: false,
                valid: false,
                error: 'Invalid voucher code',
            });
        }

        // Check if voucher is active
        if (!voucher.is_active) {
            return NextResponse.json({
                success: false,
                valid: false,
                error: 'This voucher is no longer active',
            });
        }

        // Check expiration
        if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
            return NextResponse.json({
                success: false,
                valid: false,
                error: 'This voucher has expired',
            });
        }

        // Check usage limit
        if (voucher.max_uses !== null && voucher.used_count >= voucher.max_uses) {
            return NextResponse.json({
                success: false,
                valid: false,
                error: 'This voucher has reached its usage limit',
            });
        }

        // Calculate discount
        const boothPrice = Number(booth.price) || 0;
        let discountAmount = 0;
        let finalPrice = boothPrice;

        if (voucher.discount_type === 'fixed') {
            discountAmount = Math.min(Number(voucher.discount_amount), boothPrice);
            finalPrice = boothPrice - discountAmount;
        } else if (voucher.discount_type === 'percentage') {
            discountAmount = Math.floor((boothPrice * Number(voucher.discount_amount)) / 100);
            finalPrice = boothPrice - discountAmount;
        }

        // Ensure final price is not negative
        finalPrice = Math.max(0, finalPrice);

        return NextResponse.json({
            success: true,
            valid: true,
            voucher: {
                id: voucher.id,
                code: voucher.code,
                discount_amount: voucher.discount_amount,
                discount_type: voucher.discount_type,
            },
            original_price: boothPrice,
            discount_value: discountAmount,
            final_price: finalPrice,
        });
    } catch (error) {
        console.error('Voucher validation error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to validate voucher' },
            { status: 500 }
        );
    }
}
