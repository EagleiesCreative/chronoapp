'use client';

import { useState, useEffect, useCallback } from 'react';
import { Printer, PrinterCheck, AlertTriangle, FileText, RefreshCw, CheckCircle2, Trash2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

// Type for printer info from Rust
interface PrinterInfo {
    name: string;
    system_name: string;
    is_default: boolean;
    is_shared: boolean;
    driver_name: string;
    uri: string;
    state: string;
}

// Type for print job info from Rust
interface PrintJobInfo {
    id: string;
    user: string;
    size: string;
    date: string;
}

export function PrinterSelector() {
    const [printers, setPrinters] = useState<PrinterInfo[]>([]);
    const [selectedPrinter, setSelectedPrinter] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isTesting, setIsTesting] = useState(false);
    const [lastTestResult, setLastTestResult] = useState<'idle' | 'success' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [isTauriAvailable, setIsTauriAvailable] = useState(false);
    
    // Print Queue State
    const [printQueue, setPrintQueue] = useState<PrintJobInfo[]>([]);
    const [isQueueLoading, setIsQueueLoading] = useState(false);
    const [isClearingQueue, setIsClearingQueue] = useState(false);
    const [isResuming, setIsResuming] = useState(false);

    // Check if Tauri is available by trying to import the API
    useEffect(() => {
        const checkTauri = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                // Try a simple invoke to verify Tauri is really available
                await invoke('get_printers');
                setIsTauriAvailable(true);
                setIsLoading(false);
            } catch (err) {
                // If import fails or invoke fails, Tauri is not available
                console.log('Tauri not available:', err);
                setIsTauriAvailable(false);
                setIsLoading(false);
            }
        };
        checkTauri();
    }, []);

    // Load printers from Rust backend
    const loadPrinters = useCallback(async () => {
        if (!isTauriAvailable) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const printerList = await invoke<PrinterInfo[]>('get_printers');
            setPrinters(printerList);

            // Auto-select default printer
            const defaultPrinter = printerList.find(p => p.is_default);
            if (defaultPrinter && !selectedPrinter) {
                setSelectedPrinter(defaultPrinter.system_name);
            } else if (printerList.length > 0 && !selectedPrinter) {
                setSelectedPrinter(printerList[0].system_name);
            }
        } catch (err) {
            console.error('Failed to load printers:', err);
            setError(`Failed to load printers: ${err}`);
        } finally {
            setIsLoading(false);
        }
    }, [isTauriAvailable, selectedPrinter]);

    // Load printers on mount
    useEffect(() => {
        if (isTauriAvailable) {
            loadPrinters();
        }
    }, [isTauriAvailable, loadPrinters]);

    // Handle test print
    const handleTestPrint = async () => {
        if (!selectedPrinter || !isTauriAvailable) return;

        setIsTesting(true);
        setLastTestResult('idle');

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke<string>('print_test_page', { printerName: selectedPrinter });
            setLastTestResult('success');
            toast.success(result);
            fetchQueue(selectedPrinter); // Refresh queue after test
        } catch (err) {
            console.error('Print test failed:', err);
            setLastTestResult('error');
            toast.error(`Print failed: ${err}`);
        } finally {
            setIsTesting(false);
        }
    };

    // Fetch Print Queue
    const fetchQueue = useCallback(async (printerName: string = selectedPrinter) => {
        if (!printerName || !isTauriAvailable) return;
        
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const queue = await invoke<PrintJobInfo[]>('get_print_queue', { printerName });
            setPrintQueue(queue);
        } catch (err) {
            console.error('Failed to fetch print queue:', err);
            // Don't show toast for polling errors to avoid spam
        }
    }, [isTauriAvailable, selectedPrinter]);

    // Poll queue every 3 seconds for the selected printer
    useEffect(() => {
        if (!selectedPrinter || !isTauriAvailable) return;
        
        // Initial fetch
        setIsQueueLoading(true);
        fetchQueue(selectedPrinter).finally(() => setIsQueueLoading(false));
        
        // Polling interval
        const interval = setInterval(() => {
            fetchQueue(selectedPrinter);
        }, 3000);
        
        return () => clearInterval(interval);
    }, [selectedPrinter, isTauriAvailable, fetchQueue]);

    // Clear Print Queue
    const handleClearQueue = async () => {
        if (!selectedPrinter || !isTauriAvailable) return;
        
        setIsClearingQueue(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke<string>('clear_print_queue', { printerName: selectedPrinter });
            toast.success(result);
            setPrintQueue([]); // Optimistic update
        } catch (err) {
            console.error('Failed to clear queue:', err);
            toast.error(`Failed to clear queue: ${err}`);
        } finally {
            setIsClearingQueue(false);
            fetchQueue();
        }
    };

    // Resume Printer
    const handleResumePrinter = async () => {
        if (!selectedPrinter || !isTauriAvailable) return;
        
        setIsResuming(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke<string>('resume_printer', { printerName: selectedPrinter });
            toast.success(result);
        } catch (err) {
            console.error('Failed to resume printer:', err);
            toast.error(`Failed to resume printer: ${err}`);
        } finally {
            setIsResuming(false);
        }
    };

    // Fallback for non-Tauri environment
    if (!isTauriAvailable) {
        return (
            <Card className="glass-card">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Printer className="w-5 h-5" />
                        Printer Configuration
                    </CardTitle>
                    <CardDescription>
                        Printer selection requires the desktop app
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-amber-800">Desktop App Required</p>
                            <p className="text-sm text-amber-700 mt-1">
                                Printer enumeration is only available in the Tauri desktop app.
                                Please run the app using <code className="bg-amber-100 px-1 rounded">npm run tauri:dev</code>.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="glass-card">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Printer className="w-5 h-5" />
                    Printer Configuration
                </CardTitle>
                <CardDescription>
                    Select and test your printer for photo printing
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Error display */}
                {error && (
                    <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-destructive">Error</p>
                            <p className="text-sm text-muted-foreground mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {/* Printer selector cards */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Select Printer</label>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={loadPrinters}
                            disabled={isLoading}
                            title="Refresh printer list"
                            className="h-8 text-xs"
                        >
                            <RefreshCw className={`w-3 h-3 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                    </div>

                    {isLoading ? (
                        <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                            Loading printers...
                        </div>
                    ) : printers.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                            No printers found
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-2">
                            {printers.map((printer) => (
                                <div
                                    key={printer.system_name}
                                    onClick={() => setSelectedPrinter(printer.system_name)}
                                    className={`relative p-4 rounded-xl border cursor-pointer transition-all ${
                                        selectedPrinter === printer.system_name 
                                            ? 'border-primary ring-1 ring-primary bg-primary/5' 
                                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2 font-medium">
                                            <Printer className="w-4 h-4 text-primary" />
                                            <span className="line-clamp-1" title={printer.name}>{printer.name}</span>
                                        </div>
                                        {printer.is_default && (
                                            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 font-medium">
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                                        <div className="flex items-center gap-1.5 line-clamp-1">
                                            <FileText className="w-3 h-3 shrink-0" />
                                            <span title={printer.driver_name || 'Generic Driver'}>{printer.driver_name || 'Generic Driver'}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <div className={`w-1.5 h-1.5 rounded-full ${printer.state.toLowerCase() === 'idle' || printer.state === '' ? 'bg-green-500' : 'bg-amber-500'}`} />
                                            <span>{printer.state || 'Ready'}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground text-right">{printers.length} printer(s) found</p>
                </div>

                {/* Selected printer info */}
                {selectedPrinter && printers.length > 0 && (
                    <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-lg">
                        {(() => {
                            const printer = printers.find(p => p.system_name === selectedPrinter);
                            if (!printer) return null;
                            return (
                                <div className="space-y-1">
                                    <p><strong>Driver:</strong> {printer.driver_name || 'Unknown'}</p>
                                    <p><strong>Status:</strong> {printer.state}</p>
                                    {printer.is_shared && <p><strong>Shared:</strong> Yes</p>}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* Print Queue Management */}
                {selectedPrinter && (
                    <div className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold">Print Queue</h4>
                            <div className="flex items-center gap-2">
                                {isQueueLoading && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                    printQueue.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'
                                }`}>
                                    {printQueue.length} Active {printQueue.length === 1 ? 'Job' : 'Jobs'}
                                </span>
                            </div>
                        </div>
                        
                        {printQueue.length > 0 && (
                            <div className="max-h-[120px] overflow-y-auto space-y-2 pr-2">
                                {printQueue.map((job) => (
                                    <div key={job.id} className="text-xs flex justify-between items-center bg-muted/50 p-2 rounded">
                                        <div className="truncate pr-2">
                                            <span className="font-medium">{job.id}</span>
                                            <span className="text-muted-foreground ml-2">{job.date}</span>
                                        </div>
                                        <span className="text-muted-foreground whitespace-nowrap">{job.size}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        <div className="flex gap-2 pt-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs"
                                onClick={handleResumePrinter}
                                disabled={isResuming || !selectedPrinter}
                            >
                                {isResuming ? (
                                    <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                                ) : (
                                    <Play className="w-3 h-3 mr-1.5" />
                                )}
                                Resume Printer
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="w-full text-xs"
                                onClick={handleClearQueue}
                                disabled={isClearingQueue || printQueue.length === 0}
                            >
                                {isClearingQueue ? (
                                    <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                                ) : (
                                    <Trash2 className="w-3 h-3 mr-1.5" />
                                )}
                                Clear Queue
                            </Button>
                        </div>
                    </div>
                )}

                {/* Last test result */}
                {lastTestResult === 'success' && (
                    <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                        <div>
                            <p className="font-medium text-green-800">Test Print Successful</p>
                            <p className="text-sm text-green-700">Check your printer for the test page.</p>
                        </div>
                    </div>
                )}

                {/* Test print button */}
                <Button
                    onClick={handleTestPrint}
                    disabled={isTesting || !selectedPrinter || isLoading}
                    className="w-full"
                >
                    {isTesting ? (
                        <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            Printing Test Page...
                        </>
                    ) : (
                        <>
                            <FileText className="w-4 h-4 mr-2" />
                            Print Test Page
                        </>
                    )}
                </Button>

                {/* Tips */}
                <p className="text-sm text-muted-foreground">
                    The selected printer will be used for photo printing. Make sure it&apos;s loaded with photo paper.
                </p>
            </CardContent>
        </Card>
    );
}
