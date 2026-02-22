'use client';

import { motion } from 'framer-motion';
import { Camera, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { formatIDR } from '@/lib/xendit';
import { BoothStatusIndicator } from '@/components/booth/BoothStatusIndicator';
import { SlideshowBackground } from '@/components/booth/SlideshowBackground';

export function IdleScreen() {
    const { setStep, appliedVoucher } = useBoothStore();
    const { booth } = useTenantStore();

    // Calculate displayed price
    const originalPrice = booth?.price || 0;
    const finalPrice = appliedVoucher?.final_price ?? originalPrice;
    const discountValue = appliedVoucher?.discount_value ?? 0;

    // Background style from booth settings
    const backgroundStyle = booth?.background_image
        ? { backgroundImage: `url(${booth.background_image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { backgroundColor: booth?.background_color || '#ffffff' };

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
            {booth?.slideshow_enabled && <SlideshowBackground />}

            {/* Overlay for readability when using background image or slideshow */}
            {(booth?.background_image || booth?.slideshow_enabled) && (
                <div className="absolute inset-0 bg-black/40" />
            )}

            {/* Content wrapper */}
            <div className="relative z-10 flex flex-col items-center justify-center">
                {/* Minimal decorative line */}
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

                {/* Logo and title */}
                <motion.div
                    initial={{ y: -30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.6 }}
                    className="text-center mb-10"
                >
                    {/* Elegant camera icon */}
                    <motion.div
                        className={`inline-flex items-center justify-center w-20 h-20 rounded-full border mb-8 ${booth?.background_image ? 'border-white/50 bg-white/20 backdrop-blur' : 'border-border'}`}
                        animate={{ rotate: [0, 2, -2, 0] }}
                        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                    >
                        <Camera className={`w-9 h-9 ${booth?.background_image ? 'text-white' : 'text-primary'}`} strokeWidth={1.5} />
                    </motion.div>

                    <h1 className={`text-5xl md:text-6xl font-light tracking-tight mb-4 ${booth?.background_image ? 'text-white' : ''}`}>
                        <span className={booth?.background_image ? 'text-white font-medium' : 'gradient-text font-medium'}>Chrono</span>
                        <span className={booth?.background_image ? 'text-white' : 'text-foreground'}>Snap</span>
                    </h1>

                    <p className={`text-lg font-light max-w-md mx-auto ${booth?.background_image ? 'text-white/80' : 'text-muted-foreground'}`}>
                        Capture your moments in stunning photo booth style
                    </p>
                </motion.div>

                {/* Price Display */}
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.3, duration: 0.5 }}
                    className="text-center mb-8"
                >
                    {booth?.payment_bypass ? (
                        null
                    ) : (
                        <>
                            {discountValue > 0 && (
                                <div className="mb-1">
                                    <span className={`text-lg line-through ${booth?.background_image ? 'text-white/60' : 'text-muted-foreground'}`}>
                                        {formatIDR(originalPrice)}
                                    </span>
                                    <span className="ml-2 text-sm text-green-400 font-medium">
                                        -{formatIDR(discountValue)}
                                    </span>
                                </div>
                            )}
                            <p className={`text-3xl font-semibold ${booth?.background_image ? 'text-white' : 'text-foreground'}`}>
                                {formatIDR(finalPrice)}
                            </p>
                            <p className={`text-sm mt-1 ${booth?.background_image ? 'text-white/60' : 'text-muted-foreground'}`}>per session</p>

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
                        className={`px-14 py-7 text-lg font-medium rounded-full elegant-shadow touch-target transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${booth?.background_image ? 'bg-white text-black hover:bg-white/90' : ''}`}
                    >
                        Start Session
                    </Button>

                    {!booth?.payment_bypass && (
                        <Button
                            variant="outline"
                            size="lg"
                            onClick={() => setStep('voucher')}
                            className={`px-8 py-5 text-base font-normal rounded-full touch-target transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] ${booth?.background_image ? 'border-white/50 text-white hover:bg-white/10 backdrop-blur' : ''}`}
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
                    className={`absolute bottom-12 text-sm font-light tracking-wide ${booth?.background_image ? 'text-white/40' : 'text-muted-foreground/60'}`}
                >
                </motion.p>
            </div>

            {/* Bottom decorative line */}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent z-10" />
        </motion.div>
    );
}
