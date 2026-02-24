import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { RotateCcw, Check } from 'lucide-react';
import { CapturePhase } from '@/hooks/useCaptureFlow';

interface CaptureOverlayProps {
    phase: CapturePhase;
    countdown: number;
    previewCountdown: number;
    flashActive: boolean;
    cameraReady: boolean;
    handleRetake: () => void;
    handleContinue: () => void;
}

export function CaptureOverlay({
    phase,
    countdown,
    previewCountdown,
    flashActive,
    cameraReady,
    handleRetake,
    handleContinue
}: CaptureOverlayProps) {
    return (
        <>
            {/* Flash effect */}
            <motion.div
                className="absolute inset-0 bg-white z-50 pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: flashActive ? 1 : 0 }}
                transition={{ duration: 0.1 }}
            />

            {/* Countdown overlay */}
            {phase === 'countdown' && cameraReady && (
                <div className="absolute top-6 left-6 z-30">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={countdown}
                            initial={{ scale: 1.3, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.7, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            className="w-20 h-20 rounded-xl bg-white/90 backdrop-blur flex items-center justify-center elegant-shadow"
                        >
                            <span className="text-4xl font-light text-foreground">
                                {countdown > 0 ? countdown : '📸'}
                            </span>
                        </motion.div>
                    </AnimatePresence>
                </div>
            )}

            {/* Minimal corner guides */}
            <div className="absolute top-4 left-4 w-10 h-10 border-l-2 border-t-2 border-white/60 rounded-tl-lg" />
            <div className="absolute top-4 right-4 w-10 h-10 border-r-2 border-t-2 border-white/60 rounded-tr-lg" />
            <div className="absolute bottom-4 left-4 w-10 h-10 border-l-2 border-b-2 border-white/60 rounded-bl-lg" />
            <div className="absolute bottom-4 right-4 w-10 h-10 border-r-2 border-b-2 border-white/60 rounded-br-lg" />

            {/* Status message */}
            <motion.div
                className="absolute bottom-6 left-1/2 -translate-x-1/2"
                animate={{ opacity: [0.8, 1, 0.8] }}
                transition={{ repeat: Infinity, duration: 2 }}
            >
                {phase === 'countdown' && (
                    <div className="bg-white/90 backdrop-blur px-5 py-2 rounded-full elegant-shadow">
                        <p className="text-foreground font-light text-sm">
                            {countdown > 0 ? 'Get ready...' : 'Smile!'}
                        </p>
                    </div>
                )}
                {phase === 'preview' && (
                    <div className="bg-primary/95 px-5 py-2 rounded-full elegant-shadow">
                        <p className="text-primary-foreground font-light text-sm">
                            Photo captured · Continue in {previewCountdown}s
                        </p>
                    </div>
                )}
            </motion.div>

            {/* Preview action buttons */}
            {phase === 'preview' && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-4 z-30">
                    <Button
                        onClick={handleRetake}
                        variant="outline"
                        className="bg-white/95 hover:bg-white rounded-full px-6 min-h-[56px] text-base active:scale-[0.97] transition-transform"
                        aria-label="Retake this photo"
                    >
                        <RotateCcw className="w-5 h-5 mr-2" strokeWidth={1.5} />
                        Retake
                    </Button>
                    <Button
                        onClick={handleContinue}
                        className="rounded-full px-6 min-h-[56px] text-base elegant-shadow active:scale-[0.97] transition-transform"
                        aria-label="Use this photo"
                    >
                        <Check className="w-5 h-5 mr-2" strokeWidth={2} />
                        Use Photo
                    </Button>
                </div>
            )}
        </>
    );
}
