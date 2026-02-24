import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, RotateCcw, XCircle } from 'lucide-react';

interface ReviewQRCodeProps {
    downloadQR: string | null;
    uploadError: string | null;
    isCompositing: boolean;
    uploadStatus: string;
    handleRetryUpload: () => void;
}

export function ReviewQRCode({
    downloadQR,
    uploadError,
    isCompositing,
    uploadStatus,
    handleRetryUpload
}: ReviewQRCodeProps) {
    return (
        <div className="w-full bg-white border-2 border-primary/30 rounded-2xl p-6 min-h-[220px] flex flex-col items-center justify-center" style={{ minHeight: '220px' }}>
            {downloadQR ? (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center w-full"
                >
                    <div className="mb-4">
                        <p className="text-[10px] uppercase text-primary font-bold tracking-[0.15em] mb-1">
                            Scan for softcopy
                        </p>
                        <p className="text-[8px] text-muted-foreground font-light">
                            Download Strip, Photos, & GIF
                        </p>
                    </div>
                    <div className="bg-white p-2.5 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] inline-block border border-border/50">
                        <img
                            src={downloadQR}
                            alt="Sharing QR Code"
                            className="w-32 h-32"
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </div>
                </motion.div>
            ) : uploadError ? (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center px-6"
                >
                    <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <XCircle className="w-6 h-6 text-destructive/60" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">Upload Issue</p>
                    <p className="text-[10px] text-muted-foreground font-light mb-4 line-clamp-2">
                        {uploadError}
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetryUpload}
                        className="rounded-full h-9 px-6 text-[11px] font-medium"
                    >
                        <RotateCcw className="w-3.5 h-3.5 mr-2" />
                        Try Again
                    </Button>
                </motion.div>
            ) : (
                <div className="text-center py-6">
                    <div className="relative w-12 h-12 mx-auto mb-4">
                        <Loader2 className="w-12 h-12 animate-spin text-primary/30" strokeWidth={1} />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-1 h-1 bg-primary rounded-full animate-pulse" />
                        </div>
                    </div>
                    <p className="text-[10px] uppercase text-muted-foreground/60 font-medium tracking-widest mb-1">
                        {isCompositing ? 'Preparing' : 'Generating'}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-light px-4">
                        {uploadStatus || 'Digital copy coming up...'}
                    </p>
                </div>
            )}
        </div>
    );
}
