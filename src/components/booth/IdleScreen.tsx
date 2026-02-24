'use client';

import { motion } from 'framer-motion';
import { Camera, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { formatIDR } from '@/lib/xendit';
import { BoothStatusIndicator } from '@/components/booth/BoothStatusIndicator';
import { SlideshowBackground } from '@/components/booth/SlideshowBackground';
import { AttractLoop } from '@/components/booth/AttractLoop';

export function IdleScreen() {
    const { setStep, appliedVoucher } = useBoothStore();
    const { booth } = useTenantStore();
    const activeSession = useSessionProfileStore((s) => s.activeSession);

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
        : { backgroundColor: effectiveBgColor || '#ffffff' };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-screen flex flex-col items-center justify-center p-8 kiosk relative"
            style={backgroundStyle}
        >
            <BoothStatusIndicator />

            {/* Slideshow background */}
            {effectiveSlideshow && <SlideshowBackground />}

            {/* Attract loop animation */}
            {(effectiveBgImage || effectiveSlideshow) && <AttractLoop />}

            {/* Overlay for readability when using background image or slideshow */}
            {(effectiveBgImage || effectiveSlideshow) && (
                <div className="absolute inset-0 bg-black/40" />
            )}

            {/* Content wrapper */}
            <div className="relative z-10 flex flex-col items-center justify-center">
                {/* Minimal decorative line */}
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

                {/* Event mode splash */}
                {effectiveEventMode && effectiveEventSplash && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 z-0"
                    >
                        <img src={effectiveEventSplash} alt="Event" className="w-full h-full object-cover" />
                    </motion.div>
                )}

                {/* Logo and title */}
                <motion.div
                    initial={{ y: -30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.6 }}
                    className="text-center mb-10"
                >
                    {/* Logo: custom or camera icon */}
                    {effectiveBrandLogo ? (
                        <motion.div
                            className="mb-8"
                            animate={{ rotate: [0, 2, -2, 0] }}
                            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            <img
                                src={effectiveBrandLogo}
                                alt="Logo"
                                className="h-20 w-auto mx-auto object-contain drop-shadow-lg"
                            />
                        </motion.div>
                    ) : (
                        <motion.div
                            className={`inline-flex items-center justify-center w-20 h-20 rounded-full border mb-8 ${effectiveBgImage ? 'border-white/50 bg-white/20 backdrop-blur' : 'border-border'}`}
                            animate={{ rotate: [0, 2, -2, 0] }}
                            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            <Camera className={`w-9 h-9 ${effectiveBgImage ? 'text-white' : 'text-primary'}`} strokeWidth={1.5} />
                        </motion.div>
                    )}

                    {/* Title: event name, custom brand, or default */}
                    {effectiveEventMode && effectiveEventName ? (
                        <>
                            <h1 className={`text-4xl md:text-5xl font-light tracking-tight mb-3 ${effectiveBgImage ? 'text-white text-shadow-dark' : ''}`}>
                                {effectiveEventName}
                            </h1>
                            {effectiveEventHashtag && (
                                <p className={`text-xl font-medium mb-2 ${effectiveBgImage ? 'text-white/90 text-shadow-dark' : 'text-primary'}`}>
                                    {effectiveEventHashtag}
                                </p>
                            )}
                            <p className={`text-lg font-light max-w-md mx-auto ${effectiveBgImage ? 'text-white/90 text-shadow-dark' : 'text-muted-foreground'}`}>
                                {effectiveEventMessage || 'Step into the booth and capture the moment!'}
                            </p>
                        </>
                    ) : (
                        <>
                            <h1 className={`text-5xl md:text-6xl font-light tracking-tight mb-4 ${effectiveBgImage ? 'text-white' : ''}`}>
                                <span className={effectiveBgImage ? 'text-white font-medium' : 'gradient-text font-medium'}>
                                    {effectiveBrandTitle ? effectiveBrandTitle.split(' ')[0] : 'Chrono'}
                                </span>
                                <span className={effectiveBgImage ? 'text-white' : 'text-foreground'}>
                                    {effectiveBrandTitle ? effectiveBrandTitle.split(' ').slice(1).join(' ') || '' : 'Snap'}
                                </span>
                            </h1>

                            <p className={`text-lg font-light max-w-md mx-auto ${effectiveBgImage ? 'text-white/90 text-shadow-dark' : 'text-muted-foreground'}`}>
                                {effectiveBrandSubtitle || 'Capture your moments in stunning photo booth style'}
                            </p>
                        </>
                    )}
                </motion.div>

                {/* Price Display */}
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.3, duration: 0.5 }}
                    className="text-center mb-8"
                >
                    {effectivePaymentBypass ? (
                        null
                    ) : (
                        <>
                            {discountValue > 0 && (
                                <div className="mb-1">
                                    <span className={`text-lg line-through ${effectiveBgImage ? 'text-white/80 text-shadow-dark' : 'text-muted-foreground'}`}>
                                        {formatIDR(originalPrice)}
                                    </span>
                                    <span className="ml-2 text-sm text-green-400 font-medium">
                                        -{formatIDR(discountValue)}
                                    </span>
                                </div>
                            )}
                            <p className={`text-3xl font-semibold ${effectiveBgImage ? 'text-white' : 'text-foreground'}`}>
                                {formatIDR(finalPrice)}
                            </p>
                            <p className={`text-sm mt-1 ${effectiveBgImage ? 'text-white/80 text-shadow-dark' : 'text-muted-foreground'}`}>per session</p>

                            {/* Applied voucher indicator */}
                            {appliedVoucher && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm backdrop-blur"
                                >
                                    <Tag className="w-3.5 h-3.5" />
                                    <span>{appliedVoucher.code}</span>
                                </motion.div>
                            )}
                        </>
                    )}
                </motion.div>

                {/* Action Buttons */}
                <motion.div
                    initial={{ y: 30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.5, duration: 0.6 }}
                    className="flex flex-col items-center gap-4"
                >
                    <Button
                        size="lg"
                        onClick={() => setStep('select-frame')}
                        className={`px-14 py-7 text-lg font-medium rounded-full elegant-shadow touch-target transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${effectiveBgImage ? 'bg-white text-black hover:bg-white/90' : ''}`}
                    >
                        Start Session
                    </Button>

                    {!effectivePaymentBypass && (
                        <Button
                            variant="outline"
                            size="lg"
                            onClick={() => setStep('voucher')}
                            className={`px-8 py-5 text-base font-normal rounded-full touch-target transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] ${effectiveBgImage ? 'border-white/50 text-white hover:bg-white/10 backdrop-blur' : ''}`}
                        >
                            <Tag className="w-4 h-4 mr-2" />
                            {appliedVoucher ? 'Change Voucher' : 'Use Voucher'}
                        </Button>
                    )}
                </motion.div>

                {/* Subtle bottom hint */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.2, duration: 0.8 }}
                    className={`absolute bottom-12 text-sm font-light tracking-wide ${effectiveBgImage ? 'text-white/70 text-shadow-dark' : 'text-muted-foreground/60'}`}
                >
                </motion.p>
            </div>

            {/* Bottom decorative line */}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent z-10" />
        </motion.div>
    );
}
