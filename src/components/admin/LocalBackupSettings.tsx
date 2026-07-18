'use client';

import { useEffect, useState } from 'react';
import { HardDrive, FolderOpen, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLocalSaveStore } from '@/store/local-save-store';
import { isTauri, pickSaveDirectory, checkDirectoryWritable } from '@/lib/local-save';

export function LocalBackupSettings() {
    const { enabled, setEnabled, savePath, setSavePath } = useLocalSaveStore();
    const showTauri = isTauri();
    const [pathStatus, setPathStatus] = useState<'idle' | 'ok' | 'error'>('idle');
    const effectivePathStatus = !savePath || !showTauri || !enabled ? 'idle' : pathStatus;

    useEffect(() => {
        if (!savePath || !showTauri || !enabled) {
            return;
        }

        let cancelled = false;
        checkDirectoryWritable(savePath).then((writable) => {
            if (!cancelled) {
                setPathStatus(writable ? 'ok' : 'error');
            }
        });

        return () => {
            cancelled = true;
        };
    }, [savePath, showTauri, enabled]);

    if (!showTauri) {
        return null;
    }

    return (
        <Card className="glass-card">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <HardDrive className="w-5 h-5" />
                    Local Backup
                </CardTitle>
                <CardDescription>
                    Save captured photos to a folder on this computer
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-row items-center justify-between rounded-lg border p-4 bg-muted/20">
                    <div className="space-y-0.5">
                        <Label className="text-base font-semibold">Save Photos Locally</Label>
                        <p className="text-sm text-muted-foreground">
                            Keep a local copy of every session&apos;s photos on this computer.
                        </p>
                    </div>
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>

                {enabled && (
                    <div className="space-y-3">
                        <Label className="text-sm font-medium">Save Directory</Label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <Input
                                    value={savePath || ''}
                                    onChange={(e) => setSavePath(e.target.value || null)}
                                    placeholder="/Users/.../Framr Studio Photos"
                                    className="pr-8 font-mono text-xs"
                                />
                                {effectivePathStatus === 'ok' && (
                                    <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                                )}
                                {effectivePathStatus === 'error' && (
                                    <XCircle className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
                                )}
                            </div>
                            <Button
                                variant="outline"
                                onClick={async () => {
                                    const dir = await pickSaveDirectory();
                                    if (dir) {
                                        setSavePath(dir);
                                    }
                                }}
                            >
                                <FolderOpen className="w-4 h-4 mr-2" />
                                Browse
                            </Button>
                        </div>
                        {effectivePathStatus === 'error' && (
                            <p className="text-xs text-red-500">Directory is not writable. Please choose a different folder.</p>
                        )}
                        {effectivePathStatus === 'ok' && (
                            <p className="text-xs text-green-600">Directory is ready. Photos will be saved here.</p>
                        )}
                        {!savePath && (
                            <p className="text-xs text-muted-foreground">Click Browse to choose where photos will be saved.</p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
