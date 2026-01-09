// Xendit API integration for QR Code payments

const XENDIT_API_URL = 'https://api.xendit.co';

interface CreateQRCodeRequest {
    external_id: string;
    type: 'DYNAMIC' | 'STATIC';
    callback_url: string;
    amount: number;
    currency?: string;
    expires_at?: string;
}

interface QRCodeResponse {
    id: string;
    external_id: string;
    amount: number;
    qr_string: string;
    callback_url: string;
    type: string;
    status: string;
    currency: string;
    created: string;
    updated: string;
    expires_at?: string;
}

interface InvoiceRequest {
    external_id: string;
    amount: number;
    payer_email?: string;
    description: string;
    invoice_duration?: number;
    success_redirect_url?: string;
    failure_redirect_url?: string;
    currency?: string;
    payment_methods?: string[];
}

interface InvoiceResponse {
    id: string;
    external_id: string;
    user_id: string;
    status: string;
    merchant_name: string;
    merchant_profile_picture_url: string;
    amount: number;
    payer_email?: string;
    description: string;
    expiry_date: string;
    invoice_url: string;
    available_banks: Array<{
        bank_code: string;
        collection_type: string;
        bank_account_number: string;
        transfer_amount: number;
        bank_branch: string;
        account_holder_name: string;
    }>;
    available_ewallets: Array<{
        ewallet_type: string;
    }>;
    available_qr_codes: Array<{
        qr_code_type: string;
    }>;
    should_exclude_credit_card: boolean;
    should_send_email: boolean;
    created: string;
    updated: string;
    currency: string;
}

// Server-side function to create a QR Code payment
export async function createQRCodePayment(
    externalId: string,
    amount: number,
    callbackUrl: string
): Promise<QRCodeResponse> {
    const secretKey = process.env.XENDIT_SECRET_KEY;

    if (!secretKey) {
        throw new Error('XENDIT_SECRET_KEY is not configured');
    }

    const response = await fetch(`${XENDIT_API_URL}/qr_codes`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
        },
        body: JSON.stringify({
            external_id: externalId,
            type: 'DYNAMIC',
            callback_url: callbackUrl,
            amount,
            currency: 'IDR',
        } as CreateQRCodeRequest),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create QR Code payment');
    }

    return response.json();
}

// Server-side function to create an invoice (alternative to QR code)
export async function createInvoice(
    externalId: string,
    amount: number,
    description: string,
    durationSeconds: number = 900 // 15 minutes default
): Promise<InvoiceResponse> {
    const secretKey = process.env.XENDIT_SECRET_KEY;

    if (!secretKey) {
        throw new Error('XENDIT_SECRET_KEY is not configured');
    }

    const response = await fetch(`${XENDIT_API_URL}/v2/invoices`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
        },
        body: JSON.stringify({
            external_id: externalId,
            amount,
            description,
            invoice_duration: durationSeconds,
            currency: 'IDR',
            payment_methods: ['QRIS'],
        } as InvoiceRequest),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create invoice');
    }

    return response.json();
}

// Get invoice details
export async function getInvoice(invoiceId: string): Promise<InvoiceResponse> {
    const secretKey = process.env.XENDIT_SECRET_KEY;

    if (!secretKey) {
        throw new Error('XENDIT_SECRET_KEY is not configured');
    }

    const response = await fetch(`${XENDIT_API_URL}/v2/invoices/${invoiceId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
        },
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to get invoice');
    }

    return response.json();
}

// Verify webhook callback token
export function verifyWebhookToken(token: string): boolean {
    const webhookToken = process.env.XENDIT_WEBHOOK_TOKEN;
    return token === webhookToken;
}

// Format currency for display
export function formatIDR(amount: number): string {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}
