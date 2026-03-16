'use client';

import { useEffect, useMemo, useState } from 'react';
import { Wifi, WifiOff, Battery, Printer, RefreshCcw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

type Device = {
    booth_id: string;
    booth_name: string;
    booth_code: string;
    status: 'online' | 'offline' | 'never_connected';
    device_name: string | null;
    last_heartbeat: string | null;
    printer_status?: string | null;
    prints_remaining?: number | null;
    camera_battery?: number | null;
};

type DeviceResponse = {
    success: boolean;
    summary: {
        total: number;
        online: number;
        offline: number;
        never_connected: number;
    };
    devices: Device[];
};

function formatLastSeen(iso: string | null): string {
    if (!iso) return 'Never';
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60_000) return 'just now';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

export function DeviceTelemetryDashboard() {
    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        try {
            const response = await apiFetch('/api/admin/devices');
            const json = (await response.json()) as DeviceResponse;
            if (!response.ok || !json.success) {
                throw new Error('Failed to load device telemetry');
            }
            setDevices(json.devices || []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load telemetry');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        const interval = setInterval(load, 60_000);
        return () => clearInterval(interval);
    }, []);

    const summary = useMemo(() => {
        const online = devices.filter(d => d.status === 'online').length;
        const offline = devices.filter(d => d.status !== 'online').length;
        return { total: devices.length, online, offline };
    }, [devices]);

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="border">
                    <CardHeader className="pb-2">
                        <CardDescription>Total Booths</CardDescription>
                        <CardTitle className="text-3xl">{summary.total}</CardTitle>
                    </CardHeader>
                </Card>
                <Card className="border">
                    <CardHeader className="pb-2">
                        <CardDescription>Online</CardDescription>
                        <CardTitle className="text-3xl text-emerald-600">{summary.online}</CardTitle>
                    </CardHeader>
                </Card>
                <Card className="border">
                    <CardHeader className="pb-2">
                        <CardDescription>Offline</CardDescription>
                        <CardTitle className="text-3xl text-rose-600">{summary.offline}</CardTitle>
                    </CardHeader>
                </Card>
            </div>

            <Card className="border">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Live Booth Telemetry</CardTitle>
                        <CardDescription>Auto-refreshes every 60 seconds</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={load}>
                        <RefreshCcw className="w-4 h-4 mr-2" />
                        Refresh
                    </Button>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <p className="text-sm text-muted-foreground">Loading telemetry...</p>
                    ) : error ? (
                        <p className="text-sm text-destructive">{error}</p>
                    ) : devices.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No active booths found.</p>
                    ) : (
                        <div className="space-y-3">
                            {devices.map((device) => (
                                <div key={device.booth_id} className="rounded-lg border p-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="font-medium">{device.booth_name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {device.device_name || 'Unknown device'} • Last seen {formatLastSeen(device.last_heartbeat)}
                                            </p>
                                        </div>
                                        <Badge variant={device.status === 'online' ? 'default' : 'destructive'}>
                                            {device.status === 'online' ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
                                            {device.status}
                                        </Badge>
                                    </div>

                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <Battery className="w-4 h-4" />
                                            Camera: {typeof device.camera_battery === 'number' ? `${device.camera_battery}%` : 'N/A'}
                                        </div>
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <Printer className="w-4 h-4" />
                                            Printer: {device.printer_status || 'unknown'}
                                        </div>
                                        <div className="text-muted-foreground">
                                            Prints left: {typeof device.prints_remaining === 'number' ? device.prints_remaining : 'N/A'}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
