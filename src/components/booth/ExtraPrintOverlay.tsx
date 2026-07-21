import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Loader2, Printer, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatIDR } from '@/lib/xendit';
import type { ExtraPrintStatus } from '@/hooks/useExtraPrint';

interface ExtraPrintOverlayProps {
    status: ExtraPrintStatus;
    qrImage: string | null;
    amount: number;
    secondsLeft: number;
    error: string | null;
    onClose: () => void;
    onRetry: () => void;
}

function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function ExtraPrintOverlay({
    status,
    qrImage,
    amount,
    secondsLeft,
    error,
    onClose,
    onRetry,
}: ExtraPrintOverlayProps) {
    if (status === 'idle') return null;

    const isFinished = status === 'expired' || status === 'failed' || status === 'error';

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            >
                <motion.div
                    initial={{ scale: 0.94, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="relative bg-white rounded-3xl p-10 shadow-2xl flex flex-col items-center w-[26rem] max-w-[90vw]"
                >
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cancel extra print"
                        className="absolute top-5 right-5 w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>

                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-border mb-4">
                        <Printer className="w-5 h-5 text-primary" strokeWidth={1.5} />
                    </div>

                    <h3 className="text-lg font-medium text-foreground mb-1">Extra Print</h3>
                    <p className="text-3xl font-light text-foreground mb-6">{formatIDR(amount)}</p>

                    {status === 'creating' && (
                        <div className="flex flex-col items-center py-10">
                            <Loader2 className="w-10 h-10 animate-spin text-primary/40 mb-4" strokeWidth={1} />
                            <p className="text-sm text-muted-foreground font-light">Preparing payment...</p>
                        </div>
                    )}

                    {status === 'awaiting' && qrImage && (
                        <>
                            <div className="bg-white p-3 rounded-2xl border border-border/60 shadow-sm mb-4">
                                <img src={qrImage} alt="Extra print payment QR" className="w-52 h-52" />
                            </div>
                            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">
                                Scan with any QRIS app
                            </p>
                            <p className="text-sm text-muted-foreground font-light">
                                Expires in <span className="font-medium text-foreground">{formatTime(secondsLeft)}</span>
                            </p>
                        </>
                    )}

                    {status === 'paid' && (
                        <div className="flex flex-col items-center py-8">
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}>
                                <CheckCircle className="w-16 h-16 text-green-500 mb-4" strokeWidth={1.5} />
                            </motion.div>
                            <p className="text-sm text-foreground font-medium mb-1">Payment received</p>
                            <p className="text-xs text-muted-foreground font-light">Sending your copy to the printer...</p>
                        </div>
                    )}

                    {isFinished && (
                        <div className="flex flex-col items-center py-6 text-center">
                            <XCircle className="w-14 h-14 text-destructive/60 mb-4" strokeWidth={1.5} />
                            <p className="text-sm font-medium text-foreground mb-1">
                                {status === 'expired' ? 'Payment time ran out' : 'Payment not completed'}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-light mb-5 px-4 line-clamp-2">
                                {error || 'No charge was made. You can try again.'}
                            </p>
                            <div className="flex gap-3">
                                <Button variant="outline" size="sm" onClick={onClose} className="rounded-full h-9 px-6 text-[11px]">
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={onRetry} className="rounded-full h-9 px-6 text-[11px]">
                                    Try Again
                                </Button>
                            </div>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
