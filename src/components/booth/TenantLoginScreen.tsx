'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Building2, Loader2, Lock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Booth } from '@/lib/supabase';

interface TenantLoginScreenProps {
    onLogin: (booth: Booth) => void;
}

export function TenantLoginScreen({ onLogin }: TenantLoginScreenProps) {
    const [code, setCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const formattedCode = code.trim().toUpperCase();

        // Client-side format validation
        const codeRegex = /^[A-Z]{4}-[0-9]{4}$/;
        if (!codeRegex.test(formattedCode)) {
            setError('Invalid format. Use: XXXX-0000');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/auth/booth-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: formattedCode }),
            });

            const data = await response.json();

            if (response.status === 429) {
                setError('Too many attempts. Please wait 1 minute.');
                setRemainingAttempts(0);
                return;
            }

            if (data.success && data.booth) {
                toast.success(`Welcome to ${data.booth.name}`);
                onLogin(data.booth);
            } else {
                setError(data.error || 'Invalid booth code');
                if (data.remainingAttempts !== undefined) {
                    setRemainingAttempts(data.remainingAttempts);
                }
            }
        } catch (err) {
            setError('Connection failed. Please try again.');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let value = e.target.value.toUpperCase();
        value = value.replace(/[^A-Z0-9-]/g, '');

        if (value.length === 4 && !value.includes('-')) {
            value = value + '-';
        }

        if (value.length > 9) {
            value = value.slice(0, 9);
        }

        setCode(value);
        setError(null);
        setRemainingAttempts(null);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="min-h-screen flex items-center justify-center bg-white p-8"
        >
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="w-full max-w-sm text-center"
            >
                {/* Icon */}
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-6">
                    <Building2 className="w-9 h-9 text-primary" strokeWidth={1.5} />
                </div>

                {/* Title */}
                <h1 className="text-3xl font-light mb-2">ChronoSnap</h1>
                <p className="text-muted-foreground mb-8">
                    Enter your booth code to start
                </p>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        <Input
                            type="text"
                            placeholder="XXXX-0000"
                            value={code}
                            onChange={handleCodeChange}
                            className="pl-12 text-center text-xl tracking-[0.15em] h-14 font-mono uppercase"
                            maxLength={9}
                            autoFocus
                            disabled={isLoading}
                        />
                    </div>

                    {/* Error message */}
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col items-center gap-1 text-destructive text-sm"
                        >
                            <div className="flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                            {remainingAttempts !== null && remainingAttempts > 0 && (
                                <span className="text-xs text-muted-foreground">
                                    {remainingAttempts} attempt{remainingAttempts !== 1 ? 's' : ''} remaining
                                </span>
                            )}
                        </motion.div>
                    )}

                    <Button
                        type="submit"
                        className="w-full h-12 text-base"
                        disabled={isLoading || code.length < 9}
                    >
                        {isLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            'Connect Booth'
                        )}
                    </Button>
                </form>

                {/* Help text */}
                <p className="mt-8 text-xs text-muted-foreground">
                    Contact your administrator if you don't have a booth code
                </p>
            </motion.div>
        </motion.div>
    );
}
