'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STREAM_BASE = 'http://localhost:3030';

type Status = 'connecting' | 'live' | 'reconnecting' | 'paused';

interface LiveViewImageProps {
    className?: string;
    alt?: string;
}

/**
 * Backend camera live view (MJPEG from the Rust stream server) that heals itself.
 *
 * - Load error → retries with a fresh URL instead of hiding (this caused the blank white view).
 * - Watchdog every 1.5s:
 *     • server frame counter (/health) advancing but the picture unchanged for 4s
 *       → WebKit stalled the <img>; reconnect (this caused the frozen view).
 *     • server counter not advancing → the camera itself is not sending frames
 *       (busy capturing, or USB trouble); show "paused" and retry every 8s.
 * - Background is black, never white, while (re)connecting.
 */
export function LiveViewImage({ className = '', alt = 'Live View' }: LiveViewImageProps) {
    const [nonce, setNonce] = useState(() => Date.now());
    const [status, setStatus] = useState<Status>('connecting');
    const imgRef = useRef<HTMLImageElement>(null);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastReconnect = useRef(0);

    const reconnect = useCallback((reason: string, delayMs = 0) => {
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
            console.warn(`[LiveView] reconnecting: ${reason}`);
            lastReconnect.current = Date.now();
            setStatus((s) => (s === 'paused' ? 'paused' : 'reconnecting'));
            setNonce(Date.now());
        }, delayMs);
    }, []);

    // WebKit keeps downloading an MJPEG stream even after React removes the <img>, so each
    // remount leaked a connection until the browser's 6-per-host limit was exhausted and the
    // live view hung on "Connecting…". Clearing src explicitly aborts the old connection.
    useEffect(() => {
        const el = imgRef.current;
        return () => {
            if (el) {
                el.removeAttribute('src');
                el.src = '';
            }
        };
    }, [nonce]);

    useEffect(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        let lastSeq = -1;
        let lastSeqChange = Date.now();
        let lastSig = '';
        let lastSigChange = Date.now();
        let cancelled = false;

        const tick = async () => {
            const now = Date.now();

            // 1. Is the server receiving frames from the camera?
            let seqAdvancing = true;
            try {
                const res = await fetch(`${STREAM_BASE}/health`, { cache: 'no-store' });
                const { seq } = (await res.json()) as { seq: number };
                if (seq !== lastSeq) {
                    lastSeq = seq;
                    lastSeqChange = now;
                }
                seqAdvancing = now - lastSeqChange < 3000;
            } catch {
                // Stream server unreachable (app restarting): keep retrying the image.
                if (!cancelled) reconnect('stream server unreachable', 0);
                return;
            }
            if (cancelled) return;

            // 2. Is the <img> actually showing new frames?
            const img = imgRef.current;
            if (ctx && img && img.naturalWidth > 0) {
                try {
                    ctx.drawImage(img, 0, 0, 8, 8);
                    const data = ctx.getImageData(0, 0, 8, 8).data;
                    let sig = '';
                    for (let i = 0; i < data.length; i += 4) sig += data[i] + data[i + 1] + data[i + 2] + ',';
                    if (sig !== lastSig) {
                        lastSig = sig;
                        lastSigChange = now;
                    }
                } catch {
                    lastSigChange = now; // cannot sample — don't treat as frozen
                }
            }

            // Chromium never fires onLoad for MJPEG, so also mark live from the watchdog.
            if (seqAdvancing && img && img.naturalWidth > 0 && now - lastSigChange < 4000) {
                setStatus('live');
            }

            if (!seqAdvancing) {
                setStatus('paused');
                if (now - lastReconnect.current > 8000) reconnect('camera not sending frames');
            } else if (now - lastSigChange > 4000 && now - lastReconnect.current > 4000) {
                reconnect('picture frozen while camera is live');
            }
        };

        const interval = setInterval(tick, 1500);
        return () => {
            cancelled = true;
            clearInterval(interval);
            if (retryTimer.current) clearTimeout(retryTimer.current);
        };
    }, [reconnect]);

    return (
        <div className="relative w-full h-full bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                key={nonce}
                ref={imgRef}
                src={`${STREAM_BASE}/stream?t=${nonce}`}
                alt={alt}
                crossOrigin="anonymous"
                className={className}
                onLoad={() => setStatus('live')}
                onError={() => reconnect('image load error', 1000)}
            />
            {status !== 'live' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="rounded-full bg-black/60 px-4 py-2 text-sm text-white/80">
                        {status === 'paused' ? 'Camera live view paused…' : 'Connecting to camera…'}
                    </span>
                </div>
            )}
        </div>
    );
}
