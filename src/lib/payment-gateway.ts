/**
 * Payment Gateway Router
 *
 * Resolves the correct payment provider for a booth based on the
 * booth organization's admin user's `payment_integration` setting.
 *
 * Supported providers: 'xendit' | 'doku'
 */

import { createQRCodePayment, getQRCode, getQRCodePayments } from '@/lib/xendit';
import { createDokuQRIS, checkDokuQRISStatus } from '@/lib/doku';
import { supabase } from '@/lib/supabase';

export type PaymentProvider = 'xendit' | 'doku';

export interface NormalizedQRIS {
    /** Opaque ID stored in payments.xendit_invoice_id — works for both providers */
    id: string;
    /** Raw QRIS string to render into a QR code image */
    qrString: string;
    expiresAt?: string;
    provider: PaymentProvider;
}

export interface NormalizedStatus {
    status: 'pending' | 'paid' | 'expired' | 'failed';
    provider: PaymentProvider;
}

// ─── Provider Resolution ───────────────────────────────────────────────────────

/**
 * Look up which payment provider is configured for this organization.
 * Falls back to 'xendit' if not set.
 */
export async function resolvePaymentProvider(organizationId: string): Promise<PaymentProvider> {
    try {
        // Find the admin user of this organization
        const { data: membership } = await supabase
            .from('organization_memberships')
            .select('user_id')
            .eq('organization_id', organizationId)
            .eq('role', 'org:admin')
            .limit(1)
            .maybeSingle();

        if (!membership?.user_id) return 'xendit';

        const { data: user } = await supabase
            .from('users')
            .select('payment_integration')
            .eq('id', membership.user_id)
            .single();

        const integration = user?.payment_integration as PaymentProvider | null;
        if (integration === 'doku') return 'doku';
        // midtrans would go here when supported
        return 'xendit';
    } catch (err) {
        console.error('[payment-gateway] Failed to resolve provider, falling back to xendit:', err);
        return 'xendit';
    }
}

// ─── Unified QRIS Creation ─────────────────────────────────────────────────────

/**
 * Create a dynamic QRIS payment via the given provider.
 * Returns a normalized response regardless of provider.
 */
export async function createQRISPayment(
    provider: PaymentProvider,
    externalId: string,
    amount: number,
    callbackUrl: string,
): Promise<NormalizedQRIS> {
    if (provider === 'doku') {
        const res = await createDokuQRIS(externalId, amount, callbackUrl);
        return {
            id: res.id,
            qrString: res.qrString,
            expiresAt: res.expiresAt,
            provider: 'doku',
        };
    }

    // Default: Xendit
    const res = await createQRCodePayment(externalId, amount, callbackUrl);
    return {
        id: res.id,
        qrString: res.qr_string,
        expiresAt: res.expires_at,
        provider: 'xendit',
    };
}

// ─── Unified Status Check ──────────────────────────────────────────────────────

/**
 * Check the payment status for a given invoice / reference ID.
 * `amount` is only needed for DOKU (required in their query API).
 */
export async function checkQRISStatus(
    provider: PaymentProvider,
    invoiceId: string,
    amount?: number,
): Promise<NormalizedStatus> {
    if (provider === 'doku') {
        try {
            const res = await checkDokuQRISStatus(invoiceId, amount ?? 0);
            const s = res.status.toUpperCase();
            let status: NormalizedStatus['status'] = 'pending';
            if (s === 'PAID' || s === 'SUCCESS' || s === 'SETTLED') status = 'paid';
            else if (s === 'EXPIRED') status = 'expired';
            else if (s === 'FAILED' || s === 'CANCELLED') status = 'failed';
            return { status, provider: 'doku' };
        } catch {
            return { status: 'pending', provider: 'doku' };
        }
    }

    // Xendit
    try {
        const payments = await getQRCodePayments(invoiceId);
        if (payments?.length) {
            const isPaid = payments.some(
                (p) => p.status === 'COMPLETED' || p.status === 'SUCCEEDED' || p.status === 'PAID'
            );
            if (isPaid) return { status: 'paid', provider: 'xendit' };
        }

        const qr = await getQRCode(invoiceId);
        if (qr.status === 'INACTIVE') return { status: 'expired', provider: 'xendit' };
    } catch {
        // Ignore — payment might not exist yet
    }

    return { status: 'pending', provider: 'xendit' };
}
