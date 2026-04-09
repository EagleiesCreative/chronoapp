import { NextRequest, NextResponse } from 'next/server';
import { getQRCode, getQRCodePayments } from '@/lib/xendit';
import { getPaymentBySessionId, updatePaymentStatus, updateSession } from '@/lib/supabase';
import { getBoothFromRequest } from '@/lib/booth-auth';

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
        let status: 'pending' | 'paid' | 'expired' | 'failed' = 'pending';
        
        try {
            const payments = await getQRCodePayments(payment.xendit_invoice_id);
            if (payments && payments.length > 0) {
                const isPaid = payments.some(p => p.status === 'COMPLETED' || p.status === 'SUCCEEDED' || p.status === 'PAID');
                if (isPaid) {
                    status = 'paid';
                }
            }
        } catch (err) {
            console.warn('Failed to get QR payments, might not exist yet:', err);
        }

        if (status === 'pending') {
            // Check if QR code is expired
            try {
                const qrCode = await getQRCode(payment.xendit_invoice_id);
                if (qrCode.status === 'INACTIVE') {
                    status = 'expired';
                }
            } catch (err) {
                console.error('Failed to get QR code status:', err);
            }
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
