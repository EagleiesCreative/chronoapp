/**
 * DOKU SNAP BI v1.0 — QRIS Integration
 *
 * Auth flow:
 *  1. Asymmetric (RSA-SHA256): Get B2B Access Token
 *  2. Symmetric (HMAC-SHA512): Sign every transactional request with that token
 *
 * Required env vars:
 *  DOKU_CLIENT_ID        — Your Client ID from DOKU Merchant Dashboard
 *  DOKU_PRIVATE_KEY      — PEM-encoded RSA private key (for token endpoint)
 *  DOKU_SECRET_KEY       — Client Secret (for transactional HMAC signing)
 *  DOKU_MERCHANT_ID      — Your Merchant ID
 *  DOKU_SANDBOX          — "true" for sandbox, omit for production
 */

import crypto from 'crypto';

const DOKU_PRD_BASE   = 'https://api.doku.com';
const DOKU_SBX_BASE   = 'https://api-sandbox.doku.com';

function getBaseUrl(): string {
    return process.env.DOKU_SANDBOX === 'true' ? DOKU_SBX_BASE : DOKU_PRD_BASE;
}

function getTimestamp(): string {
    // DOKU requires ISO 8601 with timezone offset, e.g. 2024-01-01T00:00:00+07:00
    const now = new Date();
    const offset = '+07:00';
    const pad = (n: number) => String(n).padStart(2, '0');
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}` +
        `T${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}:${pad(wib.getUTCSeconds())}${offset}`;
}

/**
 * Step 1 — Asymmetric signature for B2B token request
 * stringToSign = clientId + "|" + timestamp
 * signature    = Base64(RSA-SHA256(privateKey, stringToSign))
 */
function generateAsymmetricSignature(clientId: string, timestamp: string, privateKeyPem: string): string {
    const stringToSign = `${clientId}|${timestamp}`;
    const sign = crypto.createSign('SHA256');
    sign.update(stringToSign);
    sign.end();
    return sign.sign(privateKeyPem, 'base64');
}

/**
 * Step 2 — Symmetric signature for transactional requests (HMAC-SHA512)
 * stringToSign = METHOD + ":" + path + ":" + accessToken + ":" + lowercase(hex(sha256(minifiedBody))) + ":" + timestamp
 * signature    = Base64(HMAC-SHA512(clientSecret, stringToSign))
 */
function generateSymmetricSignature(
    method: string,
    endpointPath: string,
    accessToken: string,
    requestBody: object,
    timestamp: string,
    clientSecret: string,
): string {
    const minified = JSON.stringify(requestBody);
    const bodyHash = crypto.createHash('sha256').update(minified).digest('hex').toLowerCase();
    const stringToSign = `${method.toUpperCase()}:${endpointPath}:${accessToken}:${bodyHash}:${timestamp}`;
    return crypto.createHmac('sha512', clientSecret).update(stringToSign).digest('base64');
}

/** Cached access token to avoid re-fetching on every request within the same Lambda instance */
let _cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Fetch a B2B access token from DOKU
 */
async function getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
        return _cachedToken.token;
    }

    const clientId     = process.env.DOKU_CLIENT_ID;
    const privateKeyPem = process.env.DOKU_PRIVATE_KEY;
    if (!clientId || !privateKeyPem) {
        throw new Error('DOKU_CLIENT_ID and DOKU_PRIVATE_KEY must be configured');
    }

    const timestamp = getTimestamp();
    const signature  = generateAsymmetricSignature(clientId, timestamp, privateKeyPem);

    const res = await fetch(`${getBaseUrl()}/authorization/v1/access-token/b2b`, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'X-CLIENT-KEY':  clientId,
            'X-TIMESTAMP':   timestamp,
            'X-SIGNATURE':   signature,
        },
        body: JSON.stringify({ grantType: 'client_credentials' }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`[DOKU] Failed to get access token: ${err}`);
    }

    const data = await res.json();
    // Token typically expires in 900 seconds (15 min)
    const expiresIn = data.expiresIn ?? 900;
    _cachedToken = { token: data.accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    return _cachedToken.token;
}

// ─── Response Types ────────────────────────────────────────────────────────────

export interface DokuQRISResponse {
    /** Our internal normalized QR id (= partnerReferenceNo we sent) */
    id: string;
    /** The raw QRIS string to display to the user */
    qrString: string;
    expiresAt?: string;
}

export interface DokuQRISStatus {
    /** 'PAID' | 'PENDING' | 'EXPIRED' | 'FAILED' */
    status: string;
    amount: number;
}

// ─── Core API Functions ────────────────────────────────────────────────────────

/**
 * Generate a Dynamic QRIS payment via DOKU SNAP BI
 */
export async function createDokuQRIS(
    partnerReferenceNo: string,
    amount: number,
    callbackUrl: string,
): Promise<DokuQRISResponse> {
    const clientId     = process.env.DOKU_CLIENT_ID!;
    const clientSecret = process.env.DOKU_SECRET_KEY!;
    const merchantId   = process.env.DOKU_MERCHANT_ID!;

    if (!clientId || !clientSecret || !merchantId) {
        throw new Error('DOKU credentials (DOKU_CLIENT_ID, DOKU_SECRET_KEY, DOKU_MERCHANT_ID) are not configured');
    }

    const accessToken   = await getAccessToken();
    const timestamp     = getTimestamp();
    const endpointPath  = '/snap-adapter/b2b/v1.0/qr/qr-mpm-generate';

    // Validity 5 minutes from now
    const validUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('Z', '+07:00');

    const body = {
        partnerReferenceNo,
        amount: {
            value: `${amount}.00`,
            currency: 'IDR',
        },
        merchantId,
        validityPeriod: validUntil,
        additionalInfo: {
            callback_url: callbackUrl,
        },
    };

    const signature = generateSymmetricSignature('POST', endpointPath, accessToken, body, timestamp, clientSecret);

    const res = await fetch(`${getBaseUrl()}${endpointPath}`, {
        method: 'POST',
        headers: {
            'Content-Type':        'application/json',
            'Authorization':       `Bearer ${accessToken}`,
            'X-TIMESTAMP':         timestamp,
            'X-SIGNATURE':         signature,
            'X-PARTNER-ID':        clientId,
            'X-EXTERNAL-ID':       partnerReferenceNo,
            'CHANNEL-ID':          '95231',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`[DOKU] createQRIS failed: ${err}`);
    }

    const data = await res.json();

    if (data.responseCode !== '2002400') {
        throw new Error(`[DOKU] Unexpected response: ${data.responseCode} — ${data.responseMessage}`);
    }

    return {
        id: partnerReferenceNo,
        qrString: data.qrContent,
        expiresAt: validUntil,
    };
}

/**
 * Query the status of a DOKU QRIS payment
 */
export async function checkDokuQRISStatus(partnerReferenceNo: string, amount: number): Promise<DokuQRISStatus> {
    const clientId     = process.env.DOKU_CLIENT_ID!;
    const clientSecret = process.env.DOKU_SECRET_KEY!;
    const merchantId   = process.env.DOKU_MERCHANT_ID!;

    const accessToken  = await getAccessToken();
    const timestamp    = getTimestamp();
    const endpointPath = '/snap-adapter/b2b/v1.0/qr/qr-mpm-query';

    const body = {
        originalPartnerReferenceNo: partnerReferenceNo,
        merchantId,
        amount: {
            value: `${amount}.00`,
            currency: 'IDR',
        },
        additionalInfo: {},
    };

    const signature = generateSymmetricSignature('POST', endpointPath, accessToken, body, timestamp, clientSecret);

    const res = await fetch(`${getBaseUrl()}${endpointPath}`, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'X-TIMESTAMP':   timestamp,
            'X-SIGNATURE':   signature,
            'X-PARTNER-ID':  clientId,
            'X-EXTERNAL-ID': `query-${partnerReferenceNo}-${Date.now()}`,
            'CHANNEL-ID':    '95231',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`[DOKU] checkQRISStatus failed: ${err}`);
    }

    const data = await res.json();

    // DOKU response codes: 2005400 = success
    // transactionStatusDesc: PAID, PENDING, EXPIRED, FAILED
    return {
        status: data.transactionStatusDesc ?? 'PENDING',
        amount,
    };
}

/**
 * Verify webhook notification signature from DOKU
 * DOKU sends: X-SIGNATURE in the header
 * Verify: HMAC-SHA512(clientSecret, requestBody) === signature
 */
export function verifyDokuWebhookSignature(rawBody: string, signature: string): boolean {
    const clientSecret = process.env.DOKU_SECRET_KEY;
    if (!clientSecret) return false;
    try {
        const expected = crypto.createHmac('sha512', clientSecret).update(rawBody).digest('base64');
        // timing-safe compare
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}
