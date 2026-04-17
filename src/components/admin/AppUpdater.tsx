'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Download,
    RefreshCw,
    CheckCircle2,
    AlertCircle,
    Rocket,
    Loader2,
    ArrowDownToLine,
    RotateCcw,
    Info,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type UpdateState =
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'available'
    | 'downloading'
    | 'installing'
    | 'ready-to-restart'
    | 'error'
    | 'not-tauri';

interface UpdateInfo {
    version: string;
    date: string | null;
    body: string | null;
}

interface DownloadProgress {
    downloaded: number;
    total: number | null;
}

// Detect Tauri environment
function isTauriEnv(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function AppUpdater() {
    const [state, setState] = useState<UpdateState>('idle');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: null });
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [currentVersion, setCurrentVersion] = useState<string>('...');

    // Cached reference to the update object from check()
    const [updateHandle, setUpdateHandle] = useState<any>(null);

    // Fetch current app version on mount
    useEffect(() => {
        if (!isTauriEnv()) {
            setState('not-tauri');
            return;
        }

        import('@tauri-apps/api/app')
            .then(({ getVersion }) => getVersion())
            .then(setCurrentVersion)
            .catch(() => setCurrentVersion('unknown'));
    }, []);

    const checkForUpdates = useCallback(async () => {
        if (!isTauriEnv()) return;

        setState('checking');
        setErrorMessage('');
        setUpdateInfo(null);
        setUpdateHandle(null);

        try {
            const { check } = await import('@tauri-apps/plugin-updater');
            const update = await check();

            if (update) {
                setUpdateInfo({
                    version: update.version,
                    date: update.date ?? null,
                    body: update.body ?? null,
                });
                setUpdateHandle(update);
                setState('available');
                toast.info(`Update v${update.version} available`);
            } else {
                setState('up-to-date');
                toast.success('You\'re running the latest version');
            }
        } catch (err: any) {
            console.error('Update check failed:', err);
            const msg = err?.message || err?.toString() || 'Failed to check for updates';
            setErrorMessage(msg);
            setState('error');
            toast.error('Update check failed');
        }
    }, []);

    const downloadAndInstall = useCallback(async () => {
        if (!updateHandle) return;

        setState('downloading');
        setProgress({ downloaded: 0, total: null });

        try {
            let contentLength: number | null = null;
            let totalDownloaded = 0;

            await updateHandle.downloadAndInstall((event: any) => {
                switch (event.event) {
                    case 'Started':
                        contentLength = event.data.contentLength ?? null;
                        setProgress({ downloaded: 0, total: contentLength });
                        break;
                    case 'Progress':
                        totalDownloaded += event.data.chunkLength;
                        setProgress({ downloaded: totalDownloaded, total: contentLength });
                        break;
                    case 'Finished':
                        setProgress({ downloaded: totalDownloaded, total: contentLength ?? totalDownloaded });
                        break;
                }
            });

            setState('ready-to-restart');
            toast.success('Update installed — restart to apply');
        } catch (err: any) {
            console.error('Download/install failed:', err);
            const msg = err?.message || err?.toString() || 'Download failed';
            setErrorMessage(msg);
            setState('error');
            toast.error('Update installation failed');
        }
    }, [updateHandle]);

    const restartApp = useCallback(async () => {
        try {
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
        } catch (err: any) {
            console.error('Relaunch failed:', err);
            toast.error('Failed to restart. Please close and reopen the app manually.');
        }
    }, []);

    // --- Helpers ---

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function getProgressPercent(): number {
        if (!progress.total || progress.total === 0) return 0;
        return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
    }

    // --- Non-Tauri fallback ---
    if (state === 'not-tauri') {
        return (
            <Card className="border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Rocket className="w-5 h-5 text-primary" />
                        App Updates
                    </CardTitle>
                    <CardDescription>
                        Automatic updates for Framr Studio
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <Info className="w-4 h-4 shrink-0" />
                        <p>Auto-updates are available in the desktop app only.</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Rocket className="w-5 h-5 text-primary" />
                            App Updates
                        </CardTitle>
                        <CardDescription className="mt-1">
                            Current version: <span className="font-mono font-medium text-foreground">v{currentVersion}</span>
                        </CardDescription>
                    </div>

                    {/* Top-right action based on state */}
                    {(state === 'idle' || state === 'up-to-date' || state === 'error') && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={checkForUpdates}
                        >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Check for Updates
                        </Button>
                    )}
                </div>
            </CardHeader>

            <CardContent>
                {/* Checking state */}
                {state === 'checking' && (
                    <div className="flex items-center gap-3 py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">Checking for updates...</span>
                    </div>
                )}

                {/* Up to date */}
                {state === 'up-to-date' && (
                    <div className="flex items-center gap-3 py-4">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        <span className="text-sm text-emerald-700">You&apos;re running the latest version</span>
                    </div>
                )}

                {/* Update available */}
                {state === 'available' && updateInfo && (
                    <div className="space-y-4">
                        <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ArrowDownToLine className="w-5 h-5 text-blue-600" />
                                    <span className="font-medium text-sm">
                                        Version {updateInfo.version} available
                                    </span>
                                </div>
                                {updateInfo.date && (
                                    <span className="text-xs text-muted-foreground">
                                        {new Date(updateInfo.date).toLocaleDateString()}
                                    </span>
                                )}
                            </div>

                            {updateInfo.body && (
                                <div className="text-sm text-muted-foreground leading-relaxed border-t border-blue-100 pt-3">
                                    <p className="font-medium text-foreground mb-1 text-xs uppercase tracking-wide">
                                        What&apos;s New
                                    </p>
                                    <p className="whitespace-pre-wrap text-xs">
                                        {updateInfo.body.length > 500
                                            ? updateInfo.body.slice(0, 500) + '...'
                                            : updateInfo.body}
                                    </p>
                                </div>
                            )}
                        </div>

                        <Button onClick={downloadAndInstall} className="w-full">
                            <Download className="w-4 h-4 mr-2" />
                            Download &amp; Install
                        </Button>
                    </div>
                )}

                {/* Downloading */}
                {state === 'downloading' && (
                    <div className="space-y-3 py-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Downloading update...
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                                {formatBytes(progress.downloaded)}
                                {progress.total ? ` / ${formatBytes(progress.total)}` : ''}
                            </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${progress.total ? getProgressPercent() : 50}%` }}
                            />
                        </div>

                        {progress.total && (
                            <p className="text-xs text-muted-foreground text-center">
                                {getProgressPercent()}% complete
                            </p>
                        )}
                    </div>
                )}

                {/* Installing */}
                {state === 'installing' && (
                    <div className="flex items-center gap-3 py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">Installing update...</span>
                    </div>
                )}

                {/* Ready to restart */}
                {state === 'ready-to-restart' && (
                    <div className="space-y-4">
                        <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                <span className="font-medium text-sm text-emerald-800">
                                    Update installed successfully
                                </span>
                            </div>
                            <p className="text-xs text-emerald-700">
                                Restart the app to apply the update. Make sure no active photo sessions are in progress.
                            </p>
                        </div>

                        <Button onClick={restartApp} className="w-full">
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Restart Now
                        </Button>
                    </div>
                )}

                {/* Error state */}
                {state === 'error' && (
                    <div className="space-y-3">
                        <div className="rounded-lg bg-red-50 border border-red-100 p-4">
                            <div className="flex items-start gap-2">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-red-800">Update failed</p>
                                    <p className="text-xs text-red-600 mt-1 font-mono break-all">
                                        {errorMessage}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <Button variant="outline" onClick={checkForUpdates} size="sm">
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Retry
                        </Button>
                    </div>
                )}

                {/* Idle — prompt to check */}
                {state === 'idle' && (
                    <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
                        <Info className="w-4 h-4 shrink-0" />
                        <p>Click &quot;Check for Updates&quot; to see if a new version is available.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
