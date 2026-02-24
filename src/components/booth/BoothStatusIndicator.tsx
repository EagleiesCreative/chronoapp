'use client';

import { Wifi, WifiOff, Camera, AlertCircle, Upload } from 'lucide-react';
import { useBoothHealth } from '@/hooks/useBoothHealth';
import { useUploadQueue } from '@/hooks/useUploadQueue';

export function BoothStatusIndicator() {
    const { isOnline, cameraStatus } = useBoothHealth();
    const { queueCount } = useUploadQueue();

    return (
        <div className="fixed top-4 left-4 z-50 flex items-center gap-3 bg-black/40 backdrop-blur-md px-3 py-2 rounded-full border border-white/10 shadow-lg transition-all duration-300 opacity-0 hover:opacity-100">
            {/* Connection Status */}
            <div
                className={`p-1.5 rounded-full ${isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}
                title={isOnline ? 'System is online' : 'System is offline. Local save active.'}
            >
                {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            </div>

            {/* Camera Status */}
            <div
                className={`p-1.5 rounded-full ${cameraStatus === 'ok' ? 'bg-emerald-500/20 text-emerald-400' : (cameraStatus === 'error' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-500/20 text-slate-400')}`}
                title={cameraStatus === 'ok' ? 'Camera detected' : (cameraStatus === 'error' ? 'Camera error or not found' : 'Checking camera...')}
            >
                {cameraStatus === 'error' ? <AlertCircle className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
            </div>

            {/* Upload Queue Badge */}
            {queueCount > 0 && (
                <div
                    className="p-1.5 rounded-full bg-amber-500/20 text-amber-400 relative"
                    title={`${queueCount} upload(s) queued for retry`}
                >
                    <Upload className="w-5 h-5" />
                    <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                        {queueCount}
                    </span>
                </div>
            )}
        </div>
    );
}
