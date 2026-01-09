'use client';

import { useState, useEffect, useCallback } from 'react';
import { Printer, PrinterCheck, AlertTriangle, FileText, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

export function PrinterSelector() {
    const [printers, setPrinters] = useState<PrinterInfo[]>([]);
    const [selectedPrinter, setSelectedPrinter] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isTesting, setIsTesting] = useState(false);
    const [lastTestResult, setLastTestResult] = useState<'idle' | 'success' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [isTauriAvailable, setIsTauriAvailable] = useState(false);

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
        } catch (err) {
            console.error('Print test failed:', err);
            setLastTestResult('error');
            toast.error(`Print failed: ${err}`);
        } finally {
            setIsTesting(false);
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

                {/* Printer selector dropdown */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">Select Printer</label>
                    <div className="flex gap-2">
                        <Select
                            value={selectedPrinter}
                            onValueChange={setSelectedPrinter}
                            disabled={isLoading || printers.length === 0}
                        >
                            <SelectTrigger className="flex-1">
                                <SelectValue placeholder={isLoading ? "Loading printers..." : "Select a printer"} />
                            </SelectTrigger>
                            <SelectContent>
                                {printers.map((printer) => (
                                    <SelectItem key={printer.system_name} value={printer.system_name}>
                                        <div className="flex items-center gap-2">
                                            <span>{printer.name}</span>
                                            {printer.is_default && (
                                                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                                                    Default
                                                </span>
                                            )}
                                            <span className="text-xs text-muted-foreground">{printer.name}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={loadPrinters}
                            disabled={isLoading}
                            title="Refresh printer list"
                        >
                            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{printers.length} printer(s) found</p>
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
