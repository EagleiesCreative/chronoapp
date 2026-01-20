'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Tag, ArrowLeft, Delete, Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { formatIDR } from '@/lib/xendit';
import { getApiUrl } from '@/lib/api';

export function VoucherScreen() {
    const { setStep, appliedVoucher, setAppliedVoucher } = useBoothStore();
    const { booth } = useTenantStore();

    const [voucherCode, setVoucherCode] = useState('');
    const [isValidating, setIsValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const originalPrice = booth?.price || 0;
    const finalPrice = appliedVoucher?.final_price ?? originalPrice;
    const discountValue = appliedVoucher?.discount_value ?? 0;

    // On-screen keyboard keys
    const keyboardRows = [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
    ];

    const handleKeyPress = (key: string) => {
        if (voucherCode.length < 20) {
            setVoucherCode(prev => prev + key);
            setError(null);
        }
    };

    const handleBackspace = () => {
        setVoucherCode(prev => prev.slice(0, -1));
        setError(null);
    };

    const handleClear = () => {
        setVoucherCode('');
        setError(null);
    };

    const handleValidate = async () => {
        if (!voucherCode.trim()) return;

        setIsValidating(true);
        setError(null);

        try {
            const response = await fetch(getApiUrl('/api/voucher/validate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code: voucherCode }),
            });

            const data = await response.json();

            if (data.success && data.valid) {
                setAppliedVoucher({
                    code: data.voucher.code,
                    discount_amount: data.voucher.discount_amount,
                    discount_type: data.voucher.discount_type,
                    original_price: data.original_price,
                    discount_value: data.discount_value,
                    final_price: data.final_price,
                });
                setVoucherCode('');
            } else {
                setError(data.error || 'Invalid voucher code');
            }
        } catch (err) {
            setError('Failed to validate voucher');
            console.error(err);
        } finally {
            setIsValidating(false);
        }
    };

    const handleRemoveVoucher = () => {
        setAppliedVoucher(null);
        setError(null);
    };

    const handleContinue = () => {
        setStep('select-frame');
    };

    const handleBack = () => {
        setStep('idle');
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-screen flex flex-col items-center justify-center p-6 bg-white kiosk"
        >
            {/* Header */}
            <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center mb-6"
            >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border border-border mb-4">
                    <Tag className="w-7 h-7 text-primary" strokeWidth={1.5} />
                </div>
                <h2 className="text-3xl font-light mb-2">Enter Voucher Code</h2>
                <p className="text-muted-foreground font-light">
                    Use an on-screen keyboard to enter your voucher
                </p>
            </motion.div>

            {/* Price Display */}
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="text-center mb-4"
            >
                {discountValue > 0 && (
                    <div className="mb-1">
                        <span className="text-lg text-muted-foreground line-through">
                            {formatIDR(originalPrice)}
                        </span>
                        <span className="ml-2 text-sm text-green-600 font-medium">
                            -{formatIDR(discountValue)}
                        </span>
                    </div>
                )}
                <p className="text-2xl font-semibold text-foreground">
                    {formatIDR(finalPrice)}
                </p>
            </motion.div>

            {/* Applied Voucher Badge */}
            {appliedVoucher && (
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-full mb-4"
                >
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-green-800 font-medium">{appliedVoucher.code}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveVoucher}
                        className="h-6 w-6 p-0 ml-1 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-full"
                    >
                        <X className="w-3 h-3" />
                    </Button>
                </motion.div>
            )}

            {/* Input Display */}
            <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="w-full max-w-md mb-4"
            >
                <div className="relative">
                    <div className="h-16 px-6 rounded-xl border-2 border-border bg-gray-50 flex items-center justify-center">
                        <span className="text-2xl font-mono tracking-[0.3em] text-foreground">
                            {voucherCode || <span className="text-muted-foreground">_ _ _ _ _ _</span>}
                        </span>
                    </div>
                    {voucherCode && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleClear}
                            className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 p-0 text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-5 h-5" />
                        </Button>
                    )}
                </div>
                {error && (
                    <p className="text-sm text-destructive text-center mt-2">{error}</p>
                )}
            </motion.div>

            {/* On-Screen Keyboard */}
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="w-full max-w-lg space-y-2 mb-6"
            >
                {keyboardRows.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex justify-center gap-1.5">
                        {row.map((key) => (
                            <Button
                                key={key}
                                variant="outline"
                                onClick={() => handleKeyPress(key)}
                                disabled={isValidating}
                                className="w-11 h-11 text-lg font-medium rounded-lg hover:bg-gray-100 active:bg-gray-200 touch-target"
                            >
                                {key}
                            </Button>
                        ))}
                    </div>
                ))}

                {/* Bottom row with backspace and apply */}
                <div className="flex justify-center gap-2 pt-2">
                    <Button
                        variant="outline"
                        onClick={handleBackspace}
                        disabled={!voucherCode || isValidating}
                        className="h-12 px-6 rounded-lg touch-target"
                    >
                        <Delete className="w-5 h-5" />
                    </Button>
                    <Button
                        onClick={handleValidate}
                        disabled={!voucherCode.trim() || isValidating}
                        className="h-12 px-8 rounded-lg touch-target"
                    >
                        {isValidating ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Checking...
                            </>
                        ) : (
                            <>
                                <Check className="w-4 h-4 mr-2" />
                                Apply Voucher
                            </>
                        )}
                    </Button>
                </div>
            </motion.div>

            {/* Action Buttons */}
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="flex gap-4"
            >
                <Button
                    variant="ghost"
                    size="lg"
                    onClick={handleBack}
                    className="px-8 py-6 text-base font-normal rounded-full border border-border touch-target"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    Back
                </Button>
                <Button
                    size="lg"
                    onClick={handleContinue}
                    className="px-10 py-6 text-base font-medium rounded-full elegant-shadow touch-target"
                >
                    Continue
                </Button>
            </motion.div>
        </motion.div>
    );
}
