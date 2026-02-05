'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus,
    Pencil,
    Trash2,
    Image as ImageIcon,
    Eye,
    EyeOff,
    Loader2,
    ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { FrameEditor } from './FrameEditor';
import { Frame } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';

type ViewMode = 'list' | 'edit' | 'create';

export function FrameManager() {
    const [frames, setFrames] = useState<Frame[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [editingFrame, setEditingFrame] = useState<Frame | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [frameToDelete, setFrameToDelete] = useState<Frame | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [forceDeleteSessionCount, setForceDeleteSessionCount] = useState<number | null>(null);

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

    async function handleSaveFrame(frameData: Partial<Frame>) {
        const isUpdate = !!frameData.id;
        const method = isUpdate ? 'PUT' : 'POST';

        const response = await apiFetch('/api/frames', {
            method,
            body: JSON.stringify({
                id: frameData.id,
                name: frameData.name,
                imageUrl: frameData.image_url,
                photoSlots: frameData.photo_slots,
                price: frameData.price,
                isActive: frameData.is_active,
                canvasWidth: frameData.canvas_width,
                canvasHeight: frameData.canvas_height,
            }),
        });

        const data = await response.json();

        if (data.success) {
            await fetchFrames();
            setViewMode('list');
            setEditingFrame(null);
        } else {
            throw new Error(data.error);
        }
    }

    async function handleDeleteFrame(forceDelete = false) {
        if (!frameToDelete) return;

        setIsDeleting(true);
        try {
            const url = forceDelete
                ? getApiUrl(`/api/frames?id=${frameToDelete.id}&force=true`)
                : getApiUrl(`/api/frames?id=${frameToDelete.id}`);

            const response = await apiFetch(url, {
                method: 'DELETE',
            });

            const data = await response.json();

            if (data.success) {
                toast.success('Frame deleted');
                await fetchFrames();
                setDeleteDialogOpen(false);
                setFrameToDelete(null);
                setForceDeleteSessionCount(null);
            } else if (data.hasReferences) {
                // Change dialog state to force delete mode
                setForceDeleteSessionCount(data.sessionCount);
            } else {
                toast.error(data.error || 'Failed to delete');
            }
        } catch (err) {
            toast.error('Failed to delete frame');
            console.error(err);
        } finally {
            setIsDeleting(false);
        }
    }

    async function toggleFrameActive(frame: Frame) {
        try {
            const response = await apiFetch('/api/frames', {
                method: 'PUT',
                body: JSON.stringify({
                    id: frame.id,
                    isActive: !frame.is_active,
                }),
            });

            const data = await response.json();

            if (data.success) {
                await fetchFrames();
                toast.success(frame.is_active ? 'Frame hidden' : 'Frame visible');
            }
        } catch (err) {
            toast.error('Failed to update');
            console.error(err);
        }
    }

    // Editor view
    if (viewMode === 'edit' || viewMode === 'create') {
        return (
            <div className="p-6">
                <Button
                    variant="ghost"
                    onClick={() => {
                        setViewMode('list');
                        setEditingFrame(null);
                    }}
                    className="mb-6"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Frames
                </Button>

                <h2 className="text-xl font-semibold mb-6">
                    {viewMode === 'create' ? 'Create New Frame' : `Edit: ${editingFrame?.name}`}
                </h2>

                <FrameEditor
                    frame={editingFrame || undefined}
                    onSave={handleSaveFrame}
                    onCancel={() => {
                        setViewMode('list');
                        setEditingFrame(null);
                    }}
                />
            </div>
        );
    }

    // List view
    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-xl font-semibold">Frames</h2>
                    <p className="text-sm text-muted-foreground">
                        Manage photo booth frames
                    </p>
                </div>
                <Button onClick={() => setViewMode('create')}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Frame
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
                    <h3 className="text-lg font-medium mb-2">No frames yet</h3>
                    <p className="text-muted-foreground mb-6">
                        Create your first frame to get started
                    </p>
                    <Button onClick={() => setViewMode('create')}>
                        <Plus className="w-4 h-4 mr-2" />
                        Create Frame
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    <AnimatePresence>
                        {frames.map((frame) => (
                            <motion.div
                                key={frame.id}
                                layout
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className={`bg-white border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow ${!frame.is_active ? 'opacity-60' : ''
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
                                    <p className="text-xs text-muted-foreground mb-4">
                                        {frame.photo_slots?.length || 0} photo slots
                                    </p>

                                    {/* Actions */}
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => toggleFrameActive(frame)}
                                            className="flex-1 text-xs"
                                        >
                                            {frame.is_active ? (
                                                <>
                                                    <EyeOff className="w-3 h-3 mr-1" />
                                                    Hide
                                                </>
                                            ) : (
                                                <>
                                                    <Eye className="w-3 h-3 mr-1" />
                                                    Show
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setEditingFrame(frame);
                                                setViewMode('edit');
                                            }}
                                        >
                                            <Pencil className="w-3 h-3" />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setFrameToDelete(frame);
                                                setForceDeleteSessionCount(null);
                                                setDeleteDialogOpen(true);
                                            }}
                                            className="text-destructive hover:text-destructive"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}

            {/* Delete Dialog */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {forceDeleteSessionCount !== null ? 'Force Delete Frame?' : 'Delete Frame'}
                        </DialogTitle>
                        <DialogDescription>
                            {forceDeleteSessionCount !== null ? (
                                <span className="text-destructive font-medium block mt-2">
                                    Warning: This frame is used in {forceDeleteSessionCount} session(s).
                                    Deleting it will remove the frame reference from those sessions.
                                </span>
                            ) : (
                                `Are you sure you want to delete "${frameToDelete?.name}"? This cannot be undone.`
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setDeleteDialogOpen(false);
                                setForceDeleteSessionCount(null);
                            }}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => handleDeleteFrame(forceDeleteSessionCount !== null)}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Trash2 className="w-4 h-4 mr-2" />
                            )}
                            {forceDeleteSessionCount !== null ? 'Force Delete' : 'Delete'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
