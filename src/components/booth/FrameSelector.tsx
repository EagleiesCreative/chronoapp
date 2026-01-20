'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { formatIDR } from '@/lib/xendit';
import { Frame } from '@/lib/supabase';
import { getApiUrl } from '@/lib/api';

export function FrameSelector() {
    const { frames, setFrames, selectedFrame, setSelectedFrame, setStep, setIsLoading, setError } = useBoothStore();
    const { booth } = useTenantStore();
    const [currentIndex, setCurrentIndex] = useState(0);

    // Fetch frames on mount
    useEffect(() => {
        async function fetchFrames() {
            setIsLoading(true);
            try {
                const response = await fetch(getApiUrl('/api/frames'));
                const data = await response.json();

                if (data.success && data.frames) {
                    const activeFrames = data.frames.filter((f: Frame) => f.is_active);
                    setFrames(activeFrames);

                    if (activeFrames.length > 0) {
                        setSelectedFrame(activeFrames[0]);
                    }
                }
            } catch (err) {
                setError('Failed to load frames');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        }

        fetchFrames();
    }, [setFrames, setSelectedFrame, setIsLoading, setError]);

    const handlePrevious = () => {
        if (frames.length === 0) return;
        const newIndex = currentIndex === 0 ? frames.length - 1 : currentIndex - 1;
        setCurrentIndex(newIndex);
        setSelectedFrame(frames[newIndex]);
    };

    const handleNext = () => {
        if (frames.length === 0) return;
        const newIndex = currentIndex === frames.length - 1 ? 0 : currentIndex + 1;
        setCurrentIndex(newIndex);
        setSelectedFrame(frames[newIndex]);
    };

    const handleConfirm = () => {
        if (selectedFrame) {
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

            {/* Frame carousel */}
            <div className="flex items-center justify-center gap-8 w-full max-w-4xl mb-10">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handlePrevious}
                    className="w-14 h-14 rounded-full border border-border hover:bg-muted touch-target"
                    disabled={frames.length <= 1}
                >
                    <ChevronLeft className="w-6 h-6" strokeWidth={1.5} />
                </Button>

                <div className="relative w-[420px] h-[520px]">
                    <AnimatePresence mode="wait">
                        {selectedFrame ? (
                            <motion.div
                                key={selectedFrame.id}
                                initial={{ scale: 0.95, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.95, opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                                className="w-full h-full"
                            >
                                <div className="w-full h-full overflow-hidden elegant-card relative">
                                    <img
                                        src={selectedFrame.image_url}
                                        alt={selectedFrame.name}
                                        className="w-full h-full object-contain"
                                    />

                                    {/* Frame info - clean overlay */}
                                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-white via-white/95 to-transparent">
                                        <h3 className="text-xl font-medium text-foreground mb-2">
                                            {selectedFrame.name}
                                        </h3>
                                        <div className="flex items-center gap-3">
                                            <span className="text-lg font-medium text-primary">
                                                {formatIDR(booth?.price || 0)}
                                            </span>
                                            <span className="text-sm text-muted-foreground">
                                                · {selectedFrame.photo_slots?.length || 0} photos
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="w-full h-full flex items-center justify-center elegant-card"
                            >
                                <div className="text-center text-muted-foreground">
                                    <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-40" strokeWidth={1} />
                                    <p className="font-light">No frames available</p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNext}
                    className="w-14 h-14 rounded-full border border-border hover:bg-muted touch-target"
                    disabled={frames.length <= 1}
                >
                    <ChevronRight className="w-6 h-6" strokeWidth={1.5} />
                </Button>
            </div>

            {/* Frame indicators */}
            {frames.length > 1 && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="flex gap-2 mb-10"
                >
                    {frames.map((frame, index) => (
                        <button
                            key={frame.id}
                            onClick={() => {
                                setCurrentIndex(index);
                                setSelectedFrame(frame);
                            }}
                            className={`h-1.5 rounded-full transition-all duration-300 ${index === currentIndex
                                ? 'bg-primary w-8'
                                : 'bg-border w-1.5 hover:bg-muted-foreground/40'
                                }`}
                        />
                    ))}
                </motion.div>
            )}

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
