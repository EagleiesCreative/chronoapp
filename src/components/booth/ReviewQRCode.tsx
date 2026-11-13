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
        <div className="w-full bg-white border-2 border-primary/30 rounded-2xl p-6 min-h-[240px] flex flex-col items-center justify-center shadow-xs">
            {downloadQR ? (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center w-full"
                >
                    <div className="mb-4">
                        <p className="text-xs uppercase text-primary font-bold tracking-[0.14em] mb-1">
                            Scan for softcopy
                        </p>
                        <p className="text-xs text-muted-foreground font-normal">
                            Download Strip, Photos, & GIF
                        </p>
                    </div>
                    <div className="bg-white p-3 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] inline-block border border-border/60">
                        <img
                            src={downloadQR}
                            alt="Sharing QR Code"
                            className="w-36 h-36 max-w-none shrink-0 aspect-square object-contain mx-auto"
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </div>
                </motion.div>
            ) : uploadError ? (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center px-4"
                >
                    <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-3">
                        <XCircle className="w-6 h-6 text-destructive/70" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">Upload Issue</p>
                    <p className="text-xs text-muted-foreground font-normal mb-4 line-clamp-2">
                        {uploadError}
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetryUpload}
                        className="rounded-full h-10 px-6 text-xs font-medium"
                    >
                        <RotateCcw className="w-3.5 h-3.5 mr-2" />
                        Try Again
                    </Button>
                </motion.div>
            ) : (
                <div className="text-center py-6">
                    <div className="relative w-12 h-12 mx-auto mb-4">
                        <Loader2 className="w-12 h-12 animate-spin text-primary/30" strokeWidth={1.25} />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                        </div>
                    </div>
                    <p className="text-xs uppercase text-muted-foreground/80 font-semibold tracking-widest mb-1">
                        {isCompositing ? 'Preparing' : 'Generating'}
                    </p>
                    <p className="text-xs text-muted-foreground font-normal px-4">
                        {uploadStatus || 'Digital copy coming up...'}
                    </p>
                </div>
            )}
        </div>
    );
}
