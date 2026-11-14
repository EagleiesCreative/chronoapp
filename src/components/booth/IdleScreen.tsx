'use client';

import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Camera, Printer, QrCode, Sparkles, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore, useAdminStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { formatIDR } from '@/lib/xendit';
import { BoothStatusIndicator } from '@/components/booth/BoothStatusIndicator';
import { SlideshowBackground } from '@/components/booth/SlideshowBackground';
import { AttractLoop } from '@/components/booth/AttractLoop';
import { useCamera } from './CameraProvider';

const VIEWFINDER_CORNERS = [
    'top-6 left-6 sm:top-8 sm:left-8 border-t-2 border-l-2 rounded-tl-xl',
    'top-6 right-6 sm:top-8 sm:right-8 border-t-2 border-r-2 rounded-tr-xl',
    'bottom-6 left-6 sm:bottom-8 sm:left-8 border-b-2 border-l-2 rounded-bl-xl',
    'bottom-6 right-6 sm:bottom-8 sm:right-8 border-b-2 border-r-2 rounded-br-xl',
] as const;

export function IdleScreen() {
    const { setStep, appliedVoucher } = useBoothStore();
    const { isCameraMirrored, isLivePreviewEnabled } = useAdminStore();
    const { booth } = useTenantStore();
    const { stream, isCameraReady, cameraError, isBackendMode } = useCamera();
    const activeSession = useSessionProfileStore((s) => s.activeSession);
    const [showSonyStream, setShowSonyStream] = useState(true);

    const previewRef = useCallback((node: HTMLVideoElement | null) => {
        if (node && stream) {
            node.srcObject = stream;
        }
    }, [stream]);

    const isMediaSupported = typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function';

    // Session settings override booth settings
    const effectivePaymentBypass = activeSession?.payment_bypass ?? booth?.payment_bypass;
    const effectivePrice = activeSession?.price ?? booth?.price ?? 0;
    const effectiveEventMode = activeSession?.event_mode ?? booth?.event_mode;
    const effectiveEventName = activeSession?.event_name ?? booth?.event_name;
    const effectiveEventHashtag = activeSession?.event_hashtag ?? booth?.event_hashtag;
    const effectiveEventMessage = activeSession?.event_message ?? booth?.event_message;
    const effectiveEventSplash = activeSession?.event_splash_image ?? booth?.event_splash_image;
    const effectiveBrandLogo = activeSession?.brand_logo_url ?? booth?.brand_logo_url;
    const effectiveBrandTitle = activeSession?.brand_title ?? booth?.brand_title;
    const effectiveBrandSubtitle = activeSession?.brand_subtitle ?? booth?.brand_subtitle;
    const effectiveBgImage = activeSession?.background_image ?? booth?.background_image;
    const effectiveBgColor = activeSession?.background_color ?? booth?.background_color;
    const effectiveSlideshow = activeSession?.slideshow_enabled ?? booth?.slideshow_enabled;

    // Calculate displayed price
    const originalPrice = effectivePrice;
    const finalPrice = appliedVoucher?.final_price ?? originalPrice;
    const discountValue = appliedVoucher?.discount_value ?? 0;

    // Background style from session/booth settings
    const backgroundStyle = effectiveBgImage
        ? { backgroundImage: `url(${effectiveBgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { backgroundColor: effectiveBgColor || '#FDFCFB' };

    const hasEventSplash = Boolean(effectiveEventMode && effectiveEventSplash);
    const hasLivePreviewBackground = isLivePreviewEnabled && isMediaSupported && !cameraError && isCameraReady && (isBackendMode ? showSonyStream : !!stream);
    const hasDarkBackground = Boolean(effectiveBgImage || effectiveSlideshow || hasLivePreviewBackground || hasEventSplash);

    // Split multi-word title so the second part can use editorial gradient contrast on light themes
    const rawTitle = (effectiveEventMode && effectiveEventName)
        ? effectiveEventName
        : (effectiveBrandTitle || 'Framr Studio');
    const titleWords = rawTitle.trim().split(/\s+/);
    const titleFirst = titleWords[0] || '';
    const titleRest = titleWords.slice(1).join(' ');

    const subtitleText = effectiveEventMode
        ? (effectiveEventMessage || 'Step into the booth and capture the moment!')
        : (effectiveBrandSubtitle || 'Capture your moments in stunning photo booth style');

    // Fresh URL per mount so WebKit reconnects to the MJPEG stream instead of reusing a cached frame.
    const [streamNonce] = useState(() => Date.now());

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full flex flex-col items-center justify-center px-6 py-16 kiosk relative overflow-hidden"
            style={hasLivePreviewBackground ? { backgroundColor: '#0a0a0a' } : backgroundStyle}
        >
            <BoothStatusIndicator />

            {/* Full-screen live camera background before Start */}
            {hasLivePreviewBackground && (
                <div className="absolute inset-0 z-0 overflow-hidden">
                    {isBackendMode ? (
                        <img
                            src={`http://localhost:3030/stream?t=${streamNonce}`}
                            alt="Live camera background"
                            className={`w-full h-full object-cover transform ${isCameraMirrored ? 'scale-x-[-1]' : ''}`}
                            onError={() => setShowSonyStream(false)}
                        />
                    ) : (
                        <video
                            ref={previewRef}
                            autoPlay
                            playsInline
                            muted
                            className={`w-full h-full object-cover transform ${isCameraMirrored ? 'scale-x-[-1]' : ''}`}
                        />
                    )}
                    <div className="absolute inset-0 bg-black/50" />
                </div>
            )}

            {/* Full-bleed Event mode splash */}
            {!hasLivePreviewBackground && hasEventSplash && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 z-0 overflow-hidden"
                >
                    <img src={effectiveEventSplash} alt="Event" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/45" />
                </motion.div>
            )}

            {/* Slideshow background */}
            {!hasLivePreviewBackground && !hasEventSplash && effectiveSlideshow && <SlideshowBackground />}

            {/* Attract loop animation */}
            {!hasLivePreviewBackground && !hasEventSplash && (effectiveBgImage || effectiveSlideshow) && <AttractLoop />}

            {/* Overlay for readability when using background image or slideshow */}
            {!hasLivePreviewBackground && !hasEventSplash && (effectiveBgImage || effectiveSlideshow) && (
                <div className="absolute inset-0 bg-black/45 z-0" />
            )}

            {/* Ambient studio atmosphere on default light theme */}
            {!hasDarkBackground && (
                <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                    <div
                        className="absolute -top-32 left-1/2 -translate-x-1/2 w-[780px] h-[420px] rounded-full blur-3xl opacity-70"
                        style={{ background: 'radial-gradient(circle, rgba(166,144,118,0.16) 0%, rgba(166,144,118,0) 72%)' }}
                    />
                    <div
                        className="absolute -bottom-40 -left-24 w-[480px] h-[480px] rounded-full blur-3xl opacity-60"
                        style={{ background: 'radial-gradient(circle, rgba(212,201,184,0.28) 0%, rgba(212,201,184,0) 70%)' }}
                    />
                    <div
                        className="absolute -bottom-36 -right-24 w-[480px] h-[480px] rounded-full blur-3xl opacity-60"
                        style={{ background: 'radial-gradient(circle, rgba(139,115,85,0.12) 0%, rgba(139,115,85,0) 70%)' }}
                    />
                    <div
                        className="absolute inset-0 opacity-60"
                        style={{
                            backgroundImage: 'radial-gradient(rgba(139, 115, 85, 0.14) 1px, transparent 1px)',
                            backgroundSize: '28px 28px',
                            WebkitMaskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.9) 100%)',
                            maskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.9) 100%)',
                        }}
                    />
                </div>
            )}

            {/* Subtle photo-booth viewfinder corner brackets */}
            <div className="absolute inset-0 z-10 pointer-events-none">
                {VIEWFINDER_CORNERS.map((cornerClass, idx) => (
                    <div
                        key={idx}
                        className={`absolute w-7 h-7 sm:w-9 sm:h-9 ${cornerClass} ${hasDarkBackground ? 'border-white/35' : 'border-primary/25'}`}
                    />
                ))}
            </div>

            {/* Top studio status pill */}
            <motion.div
                initial={{ y: -12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="absolute top-7 inset-x-0 z-20 flex justify-center pointer-events-none"
            >
                <div className={`inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border text-[11px] font-semibold tracking-[0.22em] uppercase ${hasDarkBackground ? 'bg-black/35 border-white/25 text-white/90 backdrop-blur-md' : 'bg-white/85 border-border text-primary shadow-xs backdrop-blur-sm'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${hasDarkBackground ? 'bg-white' : 'bg-primary'}`} />
                    <span>{effectiveEventMode ? 'Event Edition' : 'Self-Portrait Studio'}</span>
                </div>
            </motion.div>

            {/* Center hero composition */}
            <div className="relative z-20 flex flex-col items-center justify-center max-w-2xl w-full text-center px-4 sm:px-6">
                {/* Emblem / Brand Logo */}
                <motion.div
                    initial={{ scale: 0.92, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.12, duration: 0.5 }}
                    className="mb-6"
                >
                    {effectiveBrandLogo ? (
                        <motion.div
                            animate={{ y: [0, -3, 0] }}
                            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            <img
                                src={effectiveBrandLogo}
                                alt="Brand logo"
                                className="h-20 sm:h-24 w-auto mx-auto object-contain drop-shadow-md"
                            />
                        </motion.div>
                    ) : (
                        <div className="relative inline-flex items-center justify-center">
                            <motion.div
                                animate={{ scale: [1, 1.1, 1], opacity: [0.45, 0.15, 0.45] }}
                                transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
                                className={`absolute w-28 h-28 rounded-full border ${hasDarkBackground ? 'border-white/30' : 'border-primary/20'}`}
                            />
                            <div className={`w-24 h-24 rounded-full flex items-center justify-center border ${hasDarkBackground ? 'bg-white/10 border-white/25 backdrop-blur-sm' : 'bg-primary/[0.05] border-primary/15'}`}>
                                <motion.div
                                    animate={{ rotate: [0, 2, -2, 0] }}
                                    transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                                    className={`w-[72px] h-[72px] rounded-full flex items-center justify-center border ${hasDarkBackground ? 'bg-white/20 border-white/45 backdrop-blur-md shadow-lg' : 'bg-white border-primary/20 shadow-[0_8px_24px_rgba(139,115,85,0.14)]'}`}
                                >
                                    <Camera className={`w-8 h-8 ${hasDarkBackground ? 'text-white' : 'text-primary'}`} strokeWidth={1.6} />
                                </motion.div>
                            </div>
                        </div>
                    )}
                </motion.div>

                {/* Editorial Title & Subtitle */}
                <motion.div
                    initial={{ y: 16, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.55 }}
                    className="mb-6"
                >
                    <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.06] mb-3.5">
                        {titleRest ? (
                            <>
                                <span className={hasDarkBackground ? 'text-white text-shadow-dark' : 'text-foreground'}>
                                    {titleFirst}{' '}
                                </span>
                                <span className={hasDarkBackground ? 'text-white/95 text-shadow-dark' : 'gradient-text'}>
                                    {titleRest}
                                </span>
                            </>
                        ) : (
                            <span className={hasDarkBackground ? 'text-white text-shadow-dark' : 'gradient-text'}>
                                {titleFirst}
                            </span>
                        )}
                    </h1>

                    {effectiveEventMode && effectiveEventHashtag && (
                        <div className="mb-3">
                            <span className={`inline-flex items-center px-3.5 py-1 rounded-full text-sm font-medium border ${hasDarkBackground ? 'bg-white/15 border-white/30 text-white backdrop-blur-sm' : 'bg-secondary border-border text-primary'}`}>
                                {effectiveEventHashtag}
                            </span>
                        </div>
                    )}

                    <p className={`text-base sm:text-lg font-normal leading-relaxed max-w-lg mx-auto ${hasDarkBackground ? 'text-white/90 text-shadow-dark' : 'text-muted-foreground'}`}>
                        {subtitleText}
                    </p>
                </motion.div>

                {/* 3-Step Studio Flow Strip */}
                <motion.div
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.28, duration: 0.5 }}
                    className={`inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-4 py-2 rounded-full border text-xs font-medium mb-6 ${hasDarkBackground ? 'bg-black/30 border-white/20 text-white/90 backdrop-blur-md' : 'bg-white/85 border-border/90 text-secondary-foreground shadow-xs backdrop-blur-sm'}`}
                >
                    <span className="inline-flex items-center gap-1.5">
                        <Sparkles className={`w-3.5 h-3.5 ${hasDarkBackground ? 'text-white/85' : 'text-primary'}`} />
                        Choose Frame
                    </span>
                    <span className={hasDarkBackground ? 'text-white/40' : 'text-border'}>•</span>
                    <span className="inline-flex items-center gap-1.5">
                        <Camera className={`w-3.5 h-3.5 ${hasDarkBackground ? 'text-white/85' : 'text-primary'}`} />
                        Strike a Pose
                    </span>
                    <span className={hasDarkBackground ? 'text-white/40' : 'text-border'}>•</span>
                    <span className="inline-flex items-center gap-1.5">
                        <Printer className={`w-3.5 h-3.5 ${hasDarkBackground ? 'text-white/85' : 'text-primary'}`} />
                        <QrCode className={`w-3.5 h-3.5 ${hasDarkBackground ? 'text-white/85' : 'text-primary'}`} />
                        Print &amp; Digital QR
                    </span>
                </motion.div>

                {/* Price & Voucher Pill */}
                {!effectivePaymentBypass && (
                    <motion.div
                        initial={{ scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.34, duration: 0.5 }}
                        className="mb-7"
                    >
                        <div className={`inline-flex flex-col items-center px-7 py-3 rounded-2xl border ${hasDarkBackground ? 'bg-black/35 border-white/25 backdrop-blur-md' : 'bg-[#FAF8F5]/90 border-border shadow-xs'}`}>
                            {discountValue > 0 && (
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-sm line-through ${hasDarkBackground ? 'text-white/75 text-shadow-dark' : 'text-muted-foreground'}`}>
                                        {formatIDR(originalPrice)}
                                    </span>
                                    <span className="text-xs font-semibold text-emerald-500">
                                        -{formatIDR(discountValue)}
                                    </span>
                                </div>
                            )}
                            <div className="flex items-baseline gap-1.5">
                                <span className={`text-2xl sm:text-3xl font-semibold tracking-tight ${hasDarkBackground ? 'text-white' : 'text-foreground'}`}>
                                    {formatIDR(finalPrice)}
                                </span>
                                <span className={`text-xs uppercase tracking-[0.14em] font-medium ${hasDarkBackground ? 'text-white/75' : 'text-muted-foreground'}`}>
                                    / session
                                </span>
                            </div>

                            {appliedVoucher && (
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className={`inline-flex items-center gap-1.5 mt-2 px-3 py-0.5 rounded-full text-xs font-medium ${hasDarkBackground ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-300/30' : 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'}`}
                                >
                                    <Tag className="w-3 h-3" />
                                    <span>{appliedVoucher.code}</span>
                                </motion.div>
                            )}
                        </div>
                    </motion.div>
                )}

                {/* Primary CTA & Voucher Action */}
                <motion.div
                    initial={{ y: 18, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.42, duration: 0.55 }}
                    className="flex flex-col items-center gap-3.5"
                >
                    <Button
                        size="lg"
                        onClick={() => setStep('select-frame')}
                        className={`group h-auto min-h-[68px] pl-10 pr-4 py-3 text-lg sm:text-xl font-semibold rounded-full touch-target transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] inline-flex items-center gap-5 ${hasDarkBackground ? 'bg-white text-neutral-900 hover:bg-white/95 shadow-[0_14px_32px_-8px_rgba(0,0,0,0.45)]' : 'bg-primary text-primary-foreground hover:bg-primary/95 shadow-[0_14px_30px_-8px_rgba(139,115,85,0.45),0_4px_12px_-2px_rgba(0,0,0,0.08)]'}`}
                    >
                        <span>Start Session</span>
                        <span className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:translate-x-0.5 ${hasDarkBackground ? 'bg-neutral-900/10 text-neutral-900' : 'bg-white/20 text-white'}`}>
                            <ArrowRight className="w-5 h-5" />
                        </span>
                    </Button>

                    {!effectivePaymentBypass && (
                        <Button
                            variant="outline"
                            size="lg"
                            onClick={() => setStep('voucher')}
                            className={`px-7 py-3 min-h-[48px] text-sm font-medium rounded-full touch-target transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] ${hasDarkBackground ? 'border-white/45 bg-black/25 text-white hover:bg-white/15 backdrop-blur-md' : 'bg-white/90 border-border text-secondary-foreground hover:bg-secondary/80 shadow-xs'}`}
                        >
                            <Tag className="w-4 h-4 mr-2" />
                            {appliedVoucher ? 'Change Voucher' : 'Use Voucher'}
                        </Button>
                    )}
                </motion.div>
            </div>

            {/* Bottom viewport hint (pinned cleanly to root container so it never overlaps buttons) */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.7 }}
                className="absolute bottom-7 inset-x-0 z-20 flex items-center justify-center gap-4 px-8 pointer-events-none"
            >
                <div className={`h-px w-12 sm:w-20 ${hasDarkBackground ? 'bg-white/25' : 'bg-gradient-to-r from-transparent to-border'}`} />
                <p className={`text-[11px] uppercase tracking-[0.24em] font-medium whitespace-nowrap ${hasDarkBackground ? 'text-white/75 text-shadow-dark' : 'text-muted-foreground/80'}`}>
                    Tap Start Session to begin
                </p>
                <div className={`h-px w-12 sm:w-20 ${hasDarkBackground ? 'bg-white/25' : 'bg-gradient-to-l from-transparent to-border'}`} />
            </motion.div>
        </motion.div>
    );
}
