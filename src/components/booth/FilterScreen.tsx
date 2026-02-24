'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { PHOTO_FILTERS, getFilterByName } from '@/lib/photo-filters';

export function FilterScreen() {
    const {
        selectedFilter,
        setSelectedFilter,
        setStep,
        capturedPhotos,
        selectedFrame,
    } = useBoothStore();

    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Build a quick composite preview of the first photo
    const firstPhoto = capturedPhotos[0]?.dataUrl;

    // Generate filtered preview whenever filter changes
    useEffect(() => {
        if (!firstPhoto) return;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.onload = () => {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const filter = getFilterByName(selectedFilter);

            // Apply CSS filter
            ctx.filter = filter.cssFilter;
            ctx.drawImage(img, 0, 0);
            ctx.filter = 'none';

            // Apply overlay
            if (filter.overlay) {
                ctx.fillStyle = filter.overlay.color;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            setPreviewImage(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = firstPhoto;
    }, [firstPhoto, selectedFilter]);

    const handleApply = () => {
        setStep('review');
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-screen flex flex-col items-center justify-center p-6 bg-white kiosk overflow-hidden"
        >
            {/* Header */}
            <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center shrink-0 mb-4"
            >
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-border mb-2">
                    <Sparkles className="w-5 h-5 text-primary" strokeWidth={1.5} />
                </div>
                <h2 className="text-xl font-light mb-1">Choose a Filter</h2>
                <p className="text-muted-foreground font-light text-sm">
                    Add a creative touch to your photos
                </p>
            </motion.div>

            {/* Preview */}
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="flex-1 flex items-center justify-center max-h-[50vh] mb-4"
            >
                <div className="elegant-card overflow-hidden rounded-xl">
                    {previewImage ? (
                        <img
                            src={previewImage}
                            alt="Filtered preview"
                            className="max-h-[45vh] w-auto object-contain"
                        />
                    ) : (
                        <div className="w-48 aspect-[3/4] bg-muted flex items-center justify-center">
                            <p className="text-muted-foreground text-sm">Loading...</p>
                        </div>
                    )}
                </div>
            </motion.div>

            {/* Filter strip */}
            <motion.div
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="w-full max-w-2xl mb-4"
            >
                <div className="flex gap-3 overflow-x-auto pb-2 justify-center hide-scrollbar">
                    {PHOTO_FILTERS.map((filter) => (
                        <button
                            key={filter.name}
                            onClick={() => setSelectedFilter(filter.name)}
                            className={`flex flex-col items-center gap-1.5 shrink-0 transition-all ${selectedFilter === filter.name
                                ? 'scale-105'
                                : 'opacity-70 hover:opacity-100'
                                }`}
                        >
                            <div
                                className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition-colors ${selectedFilter === filter.name
                                    ? 'border-primary ring-2 ring-primary/30'
                                    : 'border-border'
                                    }`}
                            >
                                {firstPhoto && (
                                    <img
                                        src={firstPhoto}
                                        alt={filter.label}
                                        className="w-full h-full object-cover"
                                        style={{ filter: filter.thumbnail }}
                                    />
                                )}
                            </div>
                            <span className={`text-xs font-light ${selectedFilter === filter.name ? 'text-primary font-medium' : 'text-muted-foreground'
                                }`}>
                                {filter.label}
                            </span>
                        </button>
                    ))}
                </div>
            </motion.div>

            {/* Apply button */}
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
            >
                <Button
                    size="lg"
                    onClick={handleApply}
                    className="rounded-full px-10 py-6 text-base elegant-shadow min-h-[56px] active:scale-[0.97] transition-transform"
                >
                    <Check className="w-5 h-5 mr-2" strokeWidth={2} />
                    Apply & Continue
                </Button>
            </motion.div>
        </motion.div>
    );
}
