import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

let _r2Client: S3Client | null = null;

function getR2Config() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET;
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

    const configured = Boolean(accountId && accessKeyId && secretAccessKey && bucket);

    return {
        configured,
        accountId,
        accessKeyId,
        secretAccessKey,
        bucket,
        publicBaseUrl,
    };
}

function getR2Client() {
    const cfg = getR2Config();
    if (!cfg.configured) return null;

    if (!_r2Client) {
        _r2Client = new S3Client({
            region: 'auto',
            endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: cfg.accessKeyId!,
                secretAccessKey: cfg.secretAccessKey!,
            },
        });
    }

    return _r2Client;
}

export function isR2Configured() {
    return getR2Config().configured;
}

export async function uploadBufferToR2(
    key: string,
    body: Buffer,
    contentType: string
): Promise<string> {
    const cfg = getR2Config();
    const client = getR2Client();

    if (!cfg.configured || !client) {
        throw new Error('R2 is not configured');
    }

    await client.send(
        new PutObjectCommand({
            Bucket: cfg.bucket!,
            Key: key,
            Body: body,
            ContentType: contentType,
        })
    );

    if (cfg.publicBaseUrl) {
        return `${cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    }

    return `https://${cfg.bucket}.${cfg.accountId}.r2.cloudflarestorage.com/${key}`;
}
