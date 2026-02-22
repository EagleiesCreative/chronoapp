'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';

interface FloatingSaveBarProps {
    isVisible: boolean;
    onSave: () => void;
    onDiscard: () => void;
    isSaving: boolean;
}

export function FloatingSaveBar({ isVisible, onSave, onDiscard, isSaving }: FloatingSaveBarProps) {
    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-2xl bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl p-4 flex items-center justify-between z-[200]"
                >
                    <div className="flex items-center gap-3 text-white">
                        <div className="bg-amber-500/20 p-2 rounded-full">
                            <AlertCircle className="w-5 h-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="font-medium text-sm">Unsaved changes</p>
                            <p className="text-xs text-slate-400">Apply your settings to see them in the kiosk</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            onClick={onDiscard}
                            disabled={isSaving}
                            className="text-slate-300 hover:text-white hover:bg-slate-800"
                        >
                            Discard
                        </Button>
                        <Button
                            onClick={onSave}
                            disabled={isSaving}
                            className="bg-white text-black hover:bg-slate-200"
                        >
                            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Apply Settings
                        </Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
