'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBoothStore } from '@/store/booth-store';

export function CountdownScreen() {
    const { setStep, selectedFrame, currentPhotoIndex, setCurrentPhotoIndex } = useBoothStore();
    const [count, setCount] = useState(3);

    const totalPhotos = selectedFrame?.photo_slots?.length || 3;

    useEffect(() => {
        if (count > 0) {
            const timer = setTimeout(() => setCount(count - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            setStep('capturing');
        }
    }, [count, setStep]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-screen flex flex-col items-center justify-center bg-white kiosk relative overflow-hidden"
        >
            {/* Photo counter */}
            <motion.div
                initial={{ y: -30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="absolute top-12 text-center"
            >
                <p className="text-lg font-light text-muted-foreground">
                    Photo {currentPhotoIndex + 1} of {totalPhotos}
                </p>
            </motion.div>

            {/* Countdown number */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={count}
                    initial={{ scale: 1.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{
                        duration: 0.4,
                        ease: [0.34, 1.56, 0.64, 1],
                    }}
                    className="relative"
                >
                    {count > 0 ? (
                        <span className="text-[180px] font-extralight gradient-text tabular-nums">
                            {count}
                        </span>
                    ) : (
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 200 }}
                        >
                            <span className="text-7xl">📸</span>
                        </motion.div>
                    )}
                </motion.div>
            </AnimatePresence>

            {/* Get ready message */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="absolute bottom-24 text-lg font-light text-muted-foreground"
            >
                {count > 0 ? 'Get ready...' : 'Smile!'}
            </motion.p>

            {/* Minimal corner decorations */}
            <div className="absolute top-8 left-8 w-12 h-12 border-l border-t border-border rounded-tl-xl" />
            <div className="absolute top-8 right-8 w-12 h-12 border-r border-t border-border rounded-tr-xl" />
            <div className="absolute bottom-8 left-8 w-12 h-12 border-l border-b border-border rounded-bl-xl" />
            <div className="absolute bottom-8 right-8 w-12 h-12 border-r border-b border-border rounded-br-xl" />
        </motion.div>
    );
}
