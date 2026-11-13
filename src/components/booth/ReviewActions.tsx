import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Printer, RotateCcw } from 'lucide-react';
import { useTenantStore } from '@/store/tenant-store';
import { formatIDR } from '@/lib/xendit';

interface ReviewActionsProps {
    isCompositing: boolean;
    isPrinting: boolean;
    handlePrint: () => void;
    printCopiesCount: number;
    handleNewSession: () => void;
    autoResetCountdown: number;
    extraPrintEnabled?: boolean;
    extraPrintPrice?: number;
    handleExtraPrint?: () => void;
    children?: React.ReactNode;
}

export function ReviewActions({
    isCompositing,
    isPrinting,
    handlePrint,
    printCopiesCount,
    handleNewSession,
    autoResetCountdown,
    extraPrintEnabled = false,
    extraPrintPrice = 0,
    handleExtraPrint,
    children
}: ReviewActionsProps) {
    const { booth } = useTenantStore();
    const printEnabled = booth?.print_enabled !== false; // Default to true if not set
    const showExtraPrint = printEnabled && extraPrintEnabled && !!handleExtraPrint;

    return (
        <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col gap-3.5 w-[260px] shrink-0 max-h-[calc(100vh-230px)] overflow-y-auto hide-scrollbar pr-1"
        >
            {/* Print button */}
            {printEnabled && (
                <Button
                    size="lg"
                    onClick={handlePrint}
                    disabled={isCompositing || isPrinting}
                    className="px-6 py-6 min-h-[56px] text-base font-medium rounded-full elegant-shadow touch-target"
                >
                    {isPrinting ? (
                        <Loader2 className="w-5 h-5 mr-2.5 animate-spin" />
                    ) : (
                        <Printer className="w-5 h-5 mr-2.5" strokeWidth={1.75} />
                    )}
                    <span className="flex-1 text-left">
                        Print Photo &nbsp;<span className="opacity-80 text-xs font-normal">({printCopiesCount} {printCopiesCount === 1 ? 'copy' : 'copies'})</span>
                    </span>
                </Button>
            )}

            {/* Paid extra copy — secondary to the included print above it */}
            {showExtraPrint && (
                <Button
                    variant="outline"
                    size="lg"
                    onClick={handleExtraPrint}
                    disabled={isCompositing || isPrinting}
                    className="px-6 py-5 min-h-[52px] text-sm font-medium rounded-full border-primary/30 bg-white text-foreground hover:bg-primary/5 touch-target"
                >
                    <Plus className="w-4 h-4 mr-2" strokeWidth={2} />
                    <span className="flex-1 text-left">
                        Extra Print &nbsp;<span className="opacity-70 text-xs font-normal">({formatIDR(extraPrintPrice)})</span>
                    </span>
                </Button>
            )}

            {children}

            {/* New session button with countdown */}
            <Button
                variant="ghost"
                size="lg"
                onClick={handleNewSession}
                className="px-6 py-4 min-h-[48px] text-sm font-medium text-muted-foreground hover:text-foreground rounded-full touch-target mt-1"
            >
                <RotateCcw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                New Session
                {autoResetCountdown > 0 && (
                    <span className="ml-1.5 text-xs opacity-70 tabular-nums">({autoResetCountdown}s)</span>
                )}
            </Button>
        </motion.div>
    );
}
