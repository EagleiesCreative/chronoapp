'use client';

import { motion } from 'framer-motion';
import { Camera, RotateCcw, ArrowLeft, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { getAssetUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

export function FinalReviewScreen() {
    const {
        capturedPhotos,
        selectedFrame,
        setCurrentPhotoIndex,
        setPendingRetakeIndex,
        setRetakeReturnStep,
        setStep,
    } = useBoothStore();

    const { booth } = useTenantStore();

    // Background style from booth settings
    const backgroundStyle = booth?.background_image
        ? { backgroundImage: `url(${booth.background_image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { backgroundColor: booth?.background_color || '#ffffff' };
    
    const hasDarkBackground = !!booth?.background_image;

    const handleRetakePhoto = (index: number) => {
        setCurrentPhotoIndex(index);
        setPendingRetakeIndex(index);
        setRetakeReturnStep('final-review');
        setStep('capturing');
    };

    const handleConfirm = () => {
        setStep('review');
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full kiosk flex relative overflow-hidden"
            style={backgroundStyle}
        >
            {/* Subtle overlay for readability if background is present */}
            {booth?.background_image && (
                <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] z-0" />
            )}

            <div className="mx-auto w-full max-w-6xl h-full flex flex-col relative z-10 p-4 md:p-8">
                <motion.div
                    initial={{ y: -20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-center mb-4 shrink-0"
                >
                    <h2 className={cn(
                        "text-3xl md:text-4xl font-light tracking-tight mb-2",
                        hasDarkBackground ? "text-white text-shadow-dark" : "text-foreground"
                    )}>
                        Final Review
                    </h2>
                    <p className={cn(
                        "text-base font-light max-w-md mx-auto",
                        hasDarkBackground ? "text-white/80 text-shadow-dark" : "text-muted-foreground"
                    )}>
                        Review your shots. Retake any that didn&apos;t turn out quite right.
                    </p>
                </motion.div>

                <div className="flex-1 flex flex-col items-center justify-center min-h-0 overflow-y-auto">

                {capturedPhotos.length > 0 ? (
                    <div className="mb-8">
                        {selectedFrame?.photo_slots?.length ? (
                            <motion.div
                                initial={{ y: 16, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                className="mb-6 flex justify-center"
                            >
                                {(() => {
                                    const cw = selectedFrame.canvas_width || 600;
                                    const ch = selectedFrame.canvas_height || 1050;
                                    const maxH = 750; // Increased for better visibility
                                    const availableH = typeof window !== 'undefined' ? window.innerHeight - 380 : maxH;
                                    const scale = Math.min(Math.min(maxH, availableH) / ch, 1);
                                    const pw = Math.round(cw * scale);
                                    const ph = Math.round(ch * scale);

                                    return (
                                        <div 
                                            className="relative rounded-2xl overflow-hidden border border-white/20 bg-white shadow-2xl transition-transform duration-700 hover:rotate-0" 
                                            style={{ 
                                                width: `${pw}px`, 
                                                height: `${ph}px`,
                                                transform: 'rotate(-1deg)',
                                                boxShadow: '0 20px 50px rgba(0,0,0,0.3), 0 0 1px rgba(255,255,255,0.5) inset'
                                            }}
                                        >
                                            {selectedFrame.photo_slots.filter((slot) => slot.layer !== 'above').map((slot, originalIndex) => (
                                                <div
                                                    key={slot.id}
                                                    className="absolute overflow-hidden z-10"
                                                    style={{
                                                        left: `${(slot.x / cw) * 100}%`,
                                                        top: `${(slot.y / ch) * 100}%`,
                                                        width: `${(slot.width / cw) * 100}%`,
                                                        height: `${(slot.height / ch) * 100}%`,
                                                        transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                                    }}
                                                >
                                                    {capturedPhotos[originalIndex]?.dataUrl ? (
                                                        <>
                                                            <img
                                                                src={capturedPhotos[originalIndex].dataUrl}
                                                                alt={`Photo ${originalIndex + 1}`}
                                                                className="w-full h-full object-cover"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRetakePhoto(originalIndex)}
                                                                className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 hover:opacity-100 transition-all duration-300 backdrop-blur-[2px]"
                                                            >
                                                                <div className="flex flex-col items-center gap-2">
                                                                    <span className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-lg transform scale-90 hover:scale-100 transition-transform">
                                                                        <RotateCcw className="w-7 h-7" strokeWidth={1.5} />
                                                                    </span>
                                                                    <span className="text-xs font-medium uppercase tracking-widest text-white/90">Retake</span>
                                                                </div>
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <div className="w-full h-full bg-muted/80 flex items-center justify-center text-muted-foreground text-xs">
                                                            {originalIndex + 1}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}

                                            <img
                                                src={getAssetUrl(selectedFrame.image_url)}
                                                alt="Frame"
                                                className="absolute inset-0 w-full h-full object-contain z-20 pointer-events-none"
                                            />

                                            {selectedFrame.photo_slots.filter((slot) => slot.layer === 'above').map((slot, originalIndex) => (
                                                <div
                                                    key={slot.id}
                                                    className="absolute overflow-hidden z-30"
                                                    style={{
                                                        left: `${(slot.x / cw) * 100}%`,
                                                        top: `${(slot.y / ch) * 100}%`,
                                                        width: `${(slot.width / cw) * 100}%`,
                                                        height: `${(slot.height / ch) * 100}%`,
                                                        transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                                    }}
                                                >
                                                    {capturedPhotos[originalIndex]?.dataUrl ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRetakePhoto(originalIndex)}
                                                            className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 hover:opacity-100 transition-all duration-300 backdrop-blur-[2px]"
                                                        >
                                                            <div className="flex flex-col items-center gap-2">
                                                                <span className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-lg transform scale-90 hover:scale-100 transition-transform">
                                                                    <RotateCcw className="w-7 h-7" strokeWidth={1.5} />
                                                                </span>
                                                                <span className="text-xs font-medium uppercase tracking-widest text-white/90">Retake</span>
                                                            </div>
                                                        </button>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </motion.div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 mb-6">
                                {capturedPhotos.map((photo, index) => (
                                    <motion.div
                                        key={photo.index}
                                        initial={{ y: 16, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        transition={{ delay: index * 0.04 }}
                                        className="rounded-2xl border border-border overflow-hidden bg-card elegant-shadow"
                                    >
                                        <div className="aspect-3/4 bg-muted">
                                            <img
                                                src={photo.dataUrl}
                                                alt={`Photo ${index + 1}`}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between p-3">
                                            <p className="text-sm text-muted-foreground">Photo {index + 1}</p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleRetakePhoto(index)}
                                                className="rounded-full"
                                            >
                                                <RotateCcw className="w-4 h-4 mr-2" strokeWidth={1.75} />
                                                Retake
                                            </Button>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="rounded-2xl border border-border bg-muted/40 p-10 text-center mb-8">
                        <Camera className="w-10 h-10 mx-auto mb-3 text-muted-foreground" strokeWidth={1.5} />
                        <p className="text-lg font-light">No photos found</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Please capture photos before continuing.
                        </p>
                    </div>
                )}

                <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex flex-col items-center gap-4 mt-3 shrink-0 pb-2"
                >
                    <Button
                        size="lg"
                        onClick={handleConfirm}
                        disabled={capturedPhotos.length === 0}
                        className={cn(
                            "rounded-full px-16 py-8 text-lg font-medium elegant-shadow transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]",
                            hasDarkBackground ? "bg-white text-black hover:bg-white/90" : "bg-primary text-primary-foreground"
                        )}
                    >
                        <Check className="w-5 h-5 mr-3" />
                        Next / Confirm
                    </Button>
                    
                    <button 
                        onClick={() => setStep('idle')} 
                        className={cn(
                            "flex items-center gap-2 text-sm font-light transition-opacity hover:opacity-100",
                            hasDarkBackground ? "text-white/60 opacity-60" : "text-muted-foreground opacity-70"
                        )}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Start Over
                    </button>
                </motion.div>
                </div>
            </div>
        </motion.div>
    );
}
