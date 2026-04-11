'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { Frame } from '@/lib/supabase';
import { apiFetch, getAssetUrl } from '@/lib/api';
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
    const { frames, setFrames, selectedFrame, setSelectedFrame, setStep, setIsLoading, isLoading, setError, setSession } = useBoothStore();
    const { booth } = useTenantStore();
    const activeSession = useSessionProfileStore((s) => s.activeSession);
    const effectivePaymentBypass = activeSession?.payment_bypass ?? booth?.payment_bypass;
    const [cachedOverlayUrls, setCachedOverlayUrls] = useState<Record<string, string>>({});

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
                    body: JSON.stringify({ frameId: selectedFrame.id }),
                });
                const data = await response.json();
                if (data.success) {
                    setSession({ id: data.sessionId });
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
            className="min-h-screen flex flex-col items-center justify-center p-8 bg-white kiosk"
        >
            {/* Header */}
            <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center mb-10"
            >
                <h2 className="text-3xl font-light mb-2 text-foreground">Choose Your Frame</h2>
                <p className="text-muted-foreground font-light">
                    Select a style for your photos
                </p>
            </motion.div>

            {/* Split Layout: Frame Grid & Preview */}
            <div className="flex gap-8 w-full max-w-6xl mb-10 flex-1 min-h-0 mt-4 max-h-[65vh]">
                {/* Left Side: Frame Grid */}
                <div 
                    className="w-1/2 overflow-y-auto pr-6 pb-8" 
                    style={{ 
                        WebkitMaskImage: 'linear-gradient(to bottom, black 90%, transparent 100%)',
                        maskImage: 'linear-gradient(to bottom, black 90%, transparent 100%)'
                    }}
                >
                    <div className="grid grid-cols-2 gap-5 auto-rows-max">
                        {frames.map((frame) => (
                            <button
                                key={frame.id}
                                onClick={() => setSelectedFrame(frame)}
                                className={`relative aspect-[3/4] rounded-2xl overflow-hidden border-2 transition-all duration-300 touch-target ${
                                    selectedFrame?.id === frame.id 
                                        ? 'border-primary ring-4 ring-primary/20 scale-[0.98]' 
                                        : 'border-border hover:border-primary/50 hover:scale-[1.02]'
                                }`}
                            >
                                <img
                                    src={cachedOverlayUrls[frame.id] || getAssetUrl(frame.image_url)}
                                    alt={frame.name}
                                    className="w-full h-full object-contain bg-white"
                                />
                                <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col items-start justify-end h-1/2">
                                    <h4 className="text-white font-medium truncate w-full text-left">{frame.name}</h4>
                                    <p className="text-white/80 text-xs text-left">
                                        {new Set((frame.photo_slots || []).map((s, i) => s.capture_index ?? i)).size || 0} photos
                                    </p>
                                </div>
                                {selectedFrame?.id === frame.id && (
                                    <div className="absolute top-3 right-3 bg-primary text-primary-foreground rounded-full p-1.5 shadow-lg">
                                        <Check className="w-4 h-4" strokeWidth={3} />
                                    </div>
                                )}
                            </button>
                        ))}
                        {frames.length === 0 && !isLoading && (
                            <div className="col-span-2 py-12 text-center text-muted-foreground bg-muted/30 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center">
                                <ImageIcon className="w-10 h-10 mb-3 opacity-40 mx-auto" strokeWidth={1} />
                                <p>No frames available</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Side: Preview */}
                <div className="w-1/2 flex flex-col items-center justify-center bg-muted/20 rounded-3xl p-4 border border-border/50 shadow-inner relative">
                    <AnimatePresence mode="wait">
                        {selectedFrame ? (
                            <motion.div
                                key={selectedFrame.id}
                                initial={{ scale: 0.95, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.95, opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                                className="w-full h-full flex flex-col items-center justify-center"
                            >
                                <div className="relative h-full w-full max-h-full rounded-xl overflow-hidden shadow-2xl flex items-center justify-center">
                                    <img
                                        src={cachedOverlayUrls[selectedFrame.id] || getAssetUrl(selectedFrame.image_url)}
                                        alt={selectedFrame.name}
                                        className="w-full h-full object-contain drop-shadow-lg"
                                    />
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="w-full h-full flex items-center justify-center text-center text-muted-foreground"
                            >
                                <div>
                                    <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-40" strokeWidth={1} />
                                    <p className="font-light text-lg">Select a frame</p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Action buttons */}
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="flex gap-4"
            >
                <Button
                    variant="ghost"
                    size="lg"
                    onClick={handleBack}
                    className="px-8 py-6 text-base font-normal rounded-full border border-border touch-target"
                >
                    Back
                </Button>

                <Button
                    size="lg"
                    onClick={handleConfirm}
                    disabled={!selectedFrame}
                    className="px-10 py-6 text-base font-medium rounded-full elegant-shadow touch-target"
                >
                    <Check className="w-4 h-4 mr-2" strokeWidth={2} />
                    Continue
                </Button>
            </motion.div>
        </motion.div>
    );
}
