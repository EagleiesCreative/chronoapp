'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Printer, CheckCircle2, XCircle, Trash2, ImageIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePrintStore } from '@/store/print-store';

export function PrintHistory() {
    const { history, clearHistory } = usePrintStore();
    const [mounted, setMounted] = useState(false);

    // Prevent hydration errors with persisted state
    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

    return (
        <Card className="glass-card mb-20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Printer className="w-5 h-5" />
                        Print History Queue
                    </CardTitle>
                    <CardDescription>
                        Recent prints from this device
                    </CardDescription>
                </div>
                {history.length > 0 && (
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={clearHistory}
                        className="h-8"
                    >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Clear
                    </Button>
                )}
            </CardHeader>
            <CardContent>
                {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                        <Printer className="w-12 h-12 mb-4 opacity-20" />
                        <p>No print history yet</p>
                    </div>
                ) : (
                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                        {history.map((job) => (
                            <div
                                key={job.id}
                                className="flex items-start justify-between p-3 rounded-xl border border-border bg-black/5"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="relative w-12 h-16 rounded overflow-hidden bg-muted flex items-center justify-center shrink-0">
                                        {job.imageUrl ? (
                                            <img src={job.imageUrl} alt="Print job" className="object-cover w-full h-full" />
                                        ) : (
                                            <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                                        )}
                                        <div className="absolute inset-0 ring-1 ring-black/10 inset-ring rounded" />
                                    </div>
                                    <div className="pt-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            {job.status === 'success' ? (
                                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                            ) : (
                                                <XCircle className="w-4 h-4 text-rose-500" />
                                            )}
                                            <span className="text-sm font-medium">
                                                {job.copies} {job.copies === 1 ? 'copy' : 'copies'}
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {format(new Date(job.timestamp), 'MMM d, yyyy • h:mm a')}
                                        </div>
                                        {job.error && (
                                            <div className="text-xs text-rose-500 mt-1 max-w-[200px] truncate" title={job.error}>
                                                {job.error}
                                            </div>
                                        )}
                                        {job.session_id && (
                                            <div className="text-xs text-muted-foreground/70 font-mono mt-1">
                                                ID: {job.session_id.split('-')[0]}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
