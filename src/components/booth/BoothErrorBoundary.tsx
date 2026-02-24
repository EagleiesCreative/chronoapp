'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoothStore } from '@/store/booth-store';

interface Props {
    children?: ReactNode;
    fallbackMessage?: string;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class BoothErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error in Booth flow:', error, errorInfo);
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
        if (this.props.onReset) {
            this.props.onReset();
        } else {
            // Default reset behavior
            const { resetSession, setStep } = useBoothStore.getState();
            resetSession();
            setStep('idle');
        }
    };

    public render() {
        if (this.state.hasError) {
            return (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="min-h-screen flex flex-col items-center justify-center p-6 bg-white kiosk"
                >
                    <div className="text-center max-w-md">
                        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <AlertTriangle className="w-8 h-8 text-destructive" strokeWidth={1.5} />
                        </div>
                        <h1 className="text-2xl font-light mb-2 text-foreground">Something went wrong</h1>
                        <p className="text-muted-foreground font-light text-sm mb-8">
                            {this.props.fallbackMessage || "We encountered an unexpected error. Please try restarting your session."}
                        </p>
                        <Button
                            size="lg"
                            onClick={this.handleReset}
                            className="rounded-full px-8 py-6 text-base"
                        >
                            <RotateCcw className="w-5 h-5 mr-2" strokeWidth={1.5} />
                            Return to Start
                        </Button>
                    </div>
                </motion.div>
            );
        }

        return this.props.children;
    }
}
