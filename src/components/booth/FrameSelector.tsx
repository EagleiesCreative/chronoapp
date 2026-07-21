'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftIcon, Check, ImageIcon, Minus, Plus, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { Frame, DEFAULT_EXTRA_PRINT_PRICE } from '@/lib/supabase';
import { formatIDR } from '@/lib/xendit';
import { apiFetch, getAssetUrl } from '@/lib/api';

/** Mirrors MAX_PRINT_COPIES in /api/payment/create. */
const MAX_PRINT_COPIES = 20;
import { getCachedFrames, setCachedFrames, getCachedImageUrl, cacheFrameImages } from '@/lib/frame-cache';

function toFiniteNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function normalizeFrame(raw: unknown): Frame {
    const frame = asRecord(raw) || {};

    const rawSlots = (() => {
        const value = frame.photo_slots;

        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }

        return Array.isArray(value) ? value : [];
    })();

    const photo_slots = rawSlots
        .map((slot, index: number) => {
            const s = asRecord(slot) || {};
            const captureIndex = Number(s.capture_index);

            return {
                id: s.id ? String(s.id) : `slot-${index}`,
                x: toFiniteNumber(s.x, 0),
                y: toFiniteNumber(s.y, 0),
                width: toFiniteNumber(s.width, 0),
                height: toFiniteNumber(s.height, 0),
                rotation: toFiniteNumber(s.rotation, 0),
                layer: s.layer === 'above' ? 'above' : 'below',
                capture_index: Number.isInteger(captureIndex) ? captureIndex : index,
            };
        })
        .filter((slot) => slot.width > 0 && slot.height > 0);

    return {
        ...(frame as Partial<Frame>),
        canvas_width: toFiniteNumber(frame.canvas_width, 600),
        canvas_height: toFiniteNumber(frame.canvas_height, 1050),
        photo_slots,
    } as Frame;
}

export function FrameSelector() {
    const { frames, setFrames, selectedFrame, setSelectedFrame, setStep, setIsLoading, isLoading, setError, setSession, printQuantity, setPrintQuantity } = useBoothStore();
    const { booth } = useTenantStore();
    const activeSession = useSessionProfileStore((s) => s.activeSession);
    const effectivePaymentBypass = activeSession?.payment_bypass ?? booth?.payment_bypass;
    const [cachedOverlayUrls, setCachedOverlayUrls] = useState<Record<string, string>>({});

    // Prints are bought upfront: the base price covers `includedCopies`, each
    // copy beyond that adds `extraPrintPrice`.
    const includedCopies = activeSession?.print_copies ?? booth?.print_copies ?? 1;
    const extraPrintPrice = booth?.extra_print_price ?? DEFAULT_EXTRA_PRINT_PRICE;
    const basePrice = activeSession?.price ?? booth?.price ?? 0;
    const printEnabled = booth?.print_enabled !== false;

    const copies = Math.min(Math.max(printQuantity ?? includedCopies, includedCopies), MAX_PRINT_COPIES);
    const extraCopies = Math.max(0, copies - includedCopies);
    const totalPrice = basePrice + extraCopies * extraPrintPrice;
    const canBuyExtraCopies = printEnabled && extraPrintPrice > 0 && !effectivePaymentBypass;

    const changeCopies = (delta: number) => {
        setPrintQuantity(Math.min(Math.max(copies + delta, includedCopies), MAX_PRINT_COPIES));
    };

    // Load indexedDB cached images for frames
    useEffect(() => {
        async function loadCachedOverlays() {
            const urls: Record<string, string> = {};
            for (const frame of frames) {
                if (frame.image_url) {
                    const url = await getCachedImageUrl(frame.image_url);
                    if (url) {
                        urls[frame.id] = url;
                    }
                }
            }
            setCachedOverlayUrls(urls);
        }
        if (frames.length > 0) {
            loadCachedOverlays();
        }
    }, [frames]);

    // Fetch frames on mount — use booth session frames if available
    useEffect(() => {
        async function fetchFrames() {
            setIsLoading(true);

            // Try cache first
            const cached = getCachedFrames().map(normalizeFrame);
            let preferredFrameId: string | null = selectedFrame?.id || null;
            if (cached.length > 0) {
                setFrames(cached);

                const cachedSelection = preferredFrameId
                    ? cached.find((f) => f.id === preferredFrameId) || cached[0]
                    : cached[0];

                if (cachedSelection) {
                    setSelectedFrame(cachedSelection);
                    preferredFrameId = cachedSelection.id;
                }

                setIsLoading(false); // Don't block UI while refreshing in background
            }

            try {
                // If active booth session exists, fetch session-specific frames
                if (activeSession?.id) {
                    const sessionFramesRes = await apiFetch(`/api/booth-sessions/${activeSession.id}/frames`);
                    const sessionFramesData = await sessionFramesRes.json() as {
                        data?: Array<{ is_active?: boolean; frames?: unknown }>;
                    };

                    if (Array.isArray(sessionFramesData.data) && sessionFramesData.data.length > 0) {
                        const sessionFrames = sessionFramesData.data
                            .filter((sf) => sf.is_active && sf.frames)
                            .map((sf) => normalizeFrame(sf.frames));

                        if (sessionFrames.length > 0) {
                            setFrames(sessionFrames);

                            const selected = preferredFrameId
                                ? sessionFrames.find((f) => f.id === preferredFrameId) || sessionFrames[0]
                                : sessionFrames[0];

                            if (selected) {
                                setSelectedFrame(selected);
                            }

                            setCachedFrames(sessionFrames);
                            void cacheFrameImages(sessionFrames);
                            return;
                        }
                    }
                }

                // Fallback: fetch all active frames from global API
                const response = await apiFetch('/api/frames');
                const data = await response.json() as {
                    success?: boolean;
                    frames?: unknown[];
                };

                if (data.success && Array.isArray(data.frames)) {
                    const activeFrames = data.frames
                        .map((f) => normalizeFrame(f))
                        .filter((f: Frame) => f.is_active);

                    setFrames(activeFrames);

                    if (activeFrames.length > 0) {
                        const selected = preferredFrameId
                            ? activeFrames.find((f) => f.id === preferredFrameId) || activeFrames[0]
                            : activeFrames[0];

                        if (selected) {
                            setSelectedFrame(selected);
                        }
                    }

                    // Cache new metadata and queue image caching
                    setCachedFrames(activeFrames);
                    void cacheFrameImages(activeFrames);
                }
            } catch (err) {
                if (cached.length === 0) {
                    setError('Failed to load frames');
                }
                console.error('Network fetch failed, using cached frames', err);
            } finally {
                setIsLoading(false);
            }
        }

        fetchFrames();
    }, [setFrames, setSelectedFrame, setIsLoading, setError, activeSession?.id, selectedFrame?.id]);

    const handleConfirm = async () => {
        if (!selectedFrame) return;

        if (effectivePaymentBypass) {
            // Bypass payment: create session directly via API
            setIsLoading(true);
            try {
                const response = await apiFetch('/api/payment/create', {
                    method: 'POST',
                    body: JSON.stringify({ frameId: selectedFrame.id, printCopies: copies }),
                });
                const data = await response.json();
                if (data.success) {
                    setSession({ id: data.sessionId });
                    // Trust the server's copy count — it clamps to booth limits.
                    setPrintQuantity(data.printCopies ?? copies);
                    setStep('capturing');
                } else {
                    setError(data.error || 'Failed to create session');
                }
            } catch (err) {
                setError('Failed to start session');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        } else {
            setStep('payment');
        }
    };

    const handleBack = () => {
        setStep('idle');
        setSelectedFrame(null);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full flex flex-row bg-white kiosk relative overflow-hidden font-poppins"
        >
            {/* Left Side: Frame Grid (~62%) */}
            <div className="flex-[62] h-full flex flex-col overflow-hidden relative z-10 border-r border-[#CFCFCF]">
                {/* Back Button & Header — fixed, never scrolls */}
                <div className="shrink-0 flex items-center gap-5 px-8 pt-6 pb-4 ml-[74px]">
                    <Button onClick={handleBack} className="w-14 h-14 rounded-full border border-border/80 shadow-sm bg-white hover:bg-gray-50 flex items-center justify-center p-0 text-black shrink-0">
                        <ArrowLeftIcon className="w-7 h-7" strokeWidth={2.5} />
                    </Button>
                    <div>
                        <h1 className="text-5xl lg:text-6xl tracking-tight font-semibold text-black leading-none">
                            Pick Your Vibe
                        </h1>
                        <p className="text-muted-foreground font-poppins mt-1 text-lg lg:text-xl">
                            Choose a frame that matches your mood today.
                        </p>
                    </div>
                </div>

                {/* Frame Grid — this is the ONLY part that scrolls */}
                <div
                    className="flex-1 min-h-0 overflow-y-auto px-8 pb-6 ml-[74px] pr-6"
                    style={{
                        WebkitMaskImage: 'linear-gradient(to bottom, black 90%, transparent 100%)',
                        maskImage: 'linear-gradient(to bottom, black 90%, transparent 100%)'
                    }}
                >
                    <div className="grid grid-cols-3 gap-5 auto-rows-max">
                        {frames.map((frame) => (
                            <button
                                key={frame.id}
                                onClick={() => setSelectedFrame(frame)}
                                className={`relative flex flex-col items-center p-2.5 rounded-[1.25rem] bg-white transition-all duration-300 touch-target shadow-sm border ${selectedFrame?.id === frame.id
                                    ? 'border-[#FFF94F] ring-[6px] ring-[#FFF94F] scale-[0.98] z-10'
                                    : 'border-border/40 hover:border-black/20 hover:shadow-md hover:-translate-y-1'
                                    }`}
                            >
                                {/* Inner Image Container */}
                                <div className="w-full aspect-[2/3] flex items-center justify-center relative overflow-hidden">
                                    <img
                                        src={cachedOverlayUrls[frame.id] || getAssetUrl(frame.image_url)}
                                        alt={frame.name}
                                        className="w-full h-full object-cover rounded-[0.75rem]"
                                    />

                                    {/* Number of Photos Pill */}
                                    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 bg-[#FDFFE0] px-3 py-1 rounded-full shadow-sm border border-[#BD9700]/20 flex items-center justify-center min-w-[max-content] whitespace-nowrap truncate">
                                        <span className="text-[#BD9700] text-[10px] font-bold uppercase tracking-wider">
                                            {new Set((frame.photo_slots || []).map((s, i) => s.capture_index ?? i)).size || 0} Photos
                                        </span>
                                    </div>
                                </div>

                                {/* Frame title */}
                                <div className="mt-2.5 mb-1.5 w-full px-2">
                                    <h4 className="text-black font-semibold text-sm truncate text-center w-full">
                                        {frame.name}
                                    </h4>
                                </div>
                            </button>
                        ))}
                        {frames.length === 0 && !isLoading && (
                            <div className="col-span-3 py-16 text-center text-muted-foreground bg-muted/20 rounded-3xl border border-dashed border-border flex flex-col items-center justify-center">
                                <ImageIcon className="w-12 h-12 mb-4 opacity-30 mx-auto" strokeWidth={1} />
                                <p className="font-medium text-lg">No frames available</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Right Side: Preview Pane (~38%) — fully fixed, no scroll */}
            <div className="flex-[38] h-full relative z-0 flex flex-col items-center overflow-hidden">
                {/* Decorative Filmstrip pattern */}
                <div
                    className="absolute inset-y-0 left-0 w-20 opacity-[0.25] pointer-events-none"
                    style={{
                        backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 72px, black 72px, black 144px)',
                        backgroundSize: '100% 144px',
                        borderRight: '1px solid rgba(0,0,0,0.1)'
                    }}
                />
                {/* Right side fade gradient */}
                <div className="absolute inset-0 bg-gradient-to-r from-white via-white/80 to-white/90 pointer-events-none z-0" />

                {/* Preview area — takes available space */}
                <div className="flex-1 min-h-0 relative z-10 flex items-center justify-center w-full px-10 pt-8">
                    <div className="w-full max-w-[500px] h-full max-h-full aspect-[2/3] bg-white border border-black/5 flex flex-col items-center justify-center transition-all duration-300">
                        <AnimatePresence mode="wait">
                            {selectedFrame ? (
                                <motion.div
                                    key={selectedFrame.id}
                                    initial={{ scale: 0.96, opacity: 0, y: 10 }}
                                    animate={{ scale: 1, opacity: 1, y: 0 }}
                                    exit={{ scale: 0.96, opacity: 0, y: -10 }}
                                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                                    className="w-full h-full flex flex-col items-center justify-center relative"
                                >
                                    <div className="w-full h-full relative flex items-center justify-center drop-shadow-2xl">
                                        <img
                                            src={cachedOverlayUrls[selectedFrame.id] || getAssetUrl(selectedFrame.image_url)}
                                            alt={selectedFrame.name}
                                            className="w-full h-full object-contain"
                                        />
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="w-full h-full flex flex-col items-center justify-center text-center opacity-40"
                                >
                                    <ImageIcon className="w-20 h-20 mx-auto mb-6 text-black/50" strokeWidth={1} />
                                    <p className="font-semibold text-xl text-black/50 tracking-tight uppercase">Select a Frame</p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Prints bought upfront — pay once, no reprint payment later */}
                {canBuyExtraCopies && (
                    <div className="shrink-0 relative z-10 w-full max-w-[400px] px-10 pt-2">
                        <div className="rounded-[1.25rem] border-2 border-black/10 bg-white px-5 py-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <Printer className="w-4 h-4 text-black/70" strokeWidth={2} />
                                    <span className="text-sm font-bold uppercase tracking-wider text-black/70">Prints</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => changeCopies(-1)}
                                        disabled={copies <= includedCopies}
                                        aria-label="Fewer prints"
                                        className="w-11 h-11 rounded-full border-2 border-black/15 flex items-center justify-center text-black disabled:opacity-30 active:scale-95 transition-transform touch-target"
                                    >
                                        <Minus className="w-4 h-4" strokeWidth={3} />
                                    </button>
                                    <span className="w-8 text-center text-2xl font-extrabold tabular-nums">{copies}</span>
                                    <button
                                        type="button"
                                        onClick={() => changeCopies(1)}
                                        disabled={copies >= MAX_PRINT_COPIES}
                                        aria-label="More prints"
                                        className="w-11 h-11 rounded-full border-2 border-black flex items-center justify-center text-black disabled:opacity-30 active:scale-95 transition-transform touch-target"
                                    >
                                        <Plus className="w-4 h-4" strokeWidth={3} />
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-baseline justify-between border-t border-black/10 pt-3">
                                <span className="text-xs text-black/50 font-medium">
                                    {includedCopies} included
                                    {extraCopies > 0 && ` + ${extraCopies} x ${formatIDR(extraPrintPrice)}`}
                                </span>
                                <span className="text-xl font-extrabold text-black tabular-nums">{formatIDR(totalPrice)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Confirm Action Button — fixed at bottom */}
                <div className="shrink-0 relative z-10 w-full max-w-[400px] px-10 pb-6 pt-4">
                    <Button
                        size="lg"
                        onClick={handleConfirm}
                        disabled={!selectedFrame}
                        className="w-full h-14 bg-white hover:bg-gray-50 border-2 border-black text-black rounded-[1.25rem] text-lg font-extrabold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 uppercase tracking-widest flex items-center justify-center gap-3 group touch-target"
                    >
                        NEXT
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1">
                            <path d="M5 12h14" />
                            <path d="m12 5 7 7-7 7" />
                        </svg>
                    </Button>
                </div>
            </div>

        </motion.div>
    );
}

