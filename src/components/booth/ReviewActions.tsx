import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, Printer, RotateCcw } from 'lucide-react';

interface ReviewActionsProps {
    isCompositing: boolean;
    isPrinting: boolean;
    handlePrint: () => void;
    printCopiesCount: number;
    handleNewSession: () => void;
    autoResetCountdown: number;
    children?: React.ReactNode;
}

export function ReviewActions({
    isCompositing,
    isPrinting,
    handlePrint,
    printCopiesCount,
    handleNewSession,
    autoResetCountdown,
    children
}: ReviewActionsProps) {
    return (
        <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col gap-4 max-h-[calc(100vh-180px)] overflow-y-auto hide-scrollbar pr-2"
        >
            {/* Print button */}
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

            {children}

            {/* New session button with countdown */}
            <Button
                variant="ghost"
                size="lg"
                onClick={handleNewSession}
                className="px-6 py-4 text-sm font-light rounded-full touch-target mt-2"
            >
                <RotateCcw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                New Session ({autoResetCountdown}s)
            </Button>
        </motion.div>
    );
}
