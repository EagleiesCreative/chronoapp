'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Image as ImageIcon,
    Loader2,
    RefreshCw,
    Cloud,
    Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Frame } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';

/**
 * Read-only frame list — frames are managed in the dashboard.
 * This component only fetches and displays frames.
 */
export function FrameManager() {
    const [frames, setFrames] = useState<Frame[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchFrames();
    }, []);

    async function fetchFrames() {
        setIsLoading(true);
        try {
            const response = await apiFetch('/api/frames');
            const data = await response.json();
            if (data.success) {
                setFrames(data.frames || []);
            }
        } catch (err) {
            toast.error('Failed to load frames');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-xl font-semibold">Frames</h2>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                        <Cloud className="w-3.5 h-3.5" />
                        Synced from Dashboard
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchFrames()}
                    disabled={isLoading}
                >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* Frames Grid */}
            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : frames.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-12 text-center">
                    <ImageIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="text-lg font-medium mb-2">No frames available</h3>
                    <p className="text-muted-foreground">
                        Create frames in the Dashboard to see them here
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    <AnimatePresence>
                        {frames.map((frame) => {
                            const uniqueCaptures = new Set(
                                frame.photo_slots?.map((s, i) => s.capture_index ?? i)
                            ).size;

                            return (
                                <motion.div
                                    key={frame.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className={`bg-white border rounded-xl overflow-hidden shadow-sm transition-shadow ${
                                        !frame.is_active ? 'opacity-60' : ''
                                    }`}
                                >
                                    {/* Preview */}
                                    <div className="relative aspect-[3/4] bg-gray-50">
                                        {frame.image_url ? (
                                            <img
                                                src={frame.image_url}
                                                alt={frame.name}
                                                className="w-full h-full object-contain"
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-full">
                                                <ImageIcon className="w-12 h-12 text-muted-foreground opacity-30" />
                                            </div>
                                        )}
                                        <div className="absolute top-3 right-3">
                                            <Badge variant={frame.is_active ? 'default' : 'secondary'}>
                                                {frame.is_active ? 'Active' : 'Hidden'}
                                            </Badge>
                                        </div>
                                    </div>

                                    {/* Info */}
                                    <div className="p-4">
                                        <h3 className="font-medium truncate mb-1">{frame.name}</h3>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <Layers className="w-3 h-3" />
                                                {frame.photo_slots?.length || 0} slots
                                            </span>
                                            <span>·</span>
                                            <span>{uniqueCaptures} photos</span>
                                            <span>·</span>
                                            <span>{frame.canvas_width}×{frame.canvas_height}</span>
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}
