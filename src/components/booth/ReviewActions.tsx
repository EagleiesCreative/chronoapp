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
            className="flex flex-col gap-4 w-[240px] shrink-0 max-h-[calc(100vh-230px)] overflow-y-auto hide-scrollbar pr-2"
        >
            {/* Print button */}
            {printEnabled && (
                <Button
                    size="lg"
                    onClick={handlePrint}
                    disabled={isCompositing || isPrinting}
                    className="px-6 py-5 text-sm font-medium rounded-full elegant-shadow touch-target"
                >
                    {isPrinting ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                        <Printer className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    )}
                    <span className="flex-1 text-left">
                        Print Photo &nbsp; <span className="opacity-70 text-xs font-normal">({printCopiesCount} {printCopiesCount === 1 ? 'copy' : 'copies'})</span>
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
                    className="-mt-2 px-6 py-5 text-sm font-medium rounded-full border-primary/30 text-foreground hover:bg-primary/5 touch-target"
                >
                    <Plus className="w-4 h-4 mr-2" strokeWidth={2} />
                    <span className="flex-1 text-left">
                        Extra Print &nbsp; <span className="opacity-70 text-xs font-normal">({formatIDR(extraPrintPrice)})</span>
                    </span>
                </Button>
            )}

            {children}

            {/* New session button with countdown */}
            <Button
                variant="ghost"
                size="lg"
                onClick={handleNewSession}
                className="px-6 py-4 text-sm font-light rounded-full touch-target mt-2"
            >
                <RotateCcw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                New Session
            </Button>
        </motion.div>
    );
}
