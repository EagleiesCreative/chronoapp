'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Plus,
    Trash2,
    Save,
    Upload,
    Loader2,
    X,
    ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { Frame, PhotoSlot, CANVAS_SIZES, DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '@/lib/supabase';
import { formatIDR } from '@/lib/xendit';
import { getApiUrl } from '@/lib/api';

interface FrameEditorProps {
    frame?: Frame;
    onSave: (frame: Partial<Frame>) => Promise<void>;
    onCancel: () => void;
}

export function FrameEditor({ frame, onSave, onCancel }: FrameEditorProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [name, setName] = useState(frame?.name || '');
    const [imageUrl, setImageUrl] = useState(frame?.image_url || '');
    const [isActive, setIsActive] = useState(frame?.is_active ?? true);
    const [photoSlots, setPhotoSlots] = useState<PhotoSlot[]>(frame?.photo_slots || []);
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [canvasWidth, setCanvasWidth] = useState(frame?.canvas_width || DEFAULT_CANVAS_WIDTH);
    const [canvasHeight, setCanvasHeight] = useState(frame?.canvas_height || DEFAULT_CANVAS_HEIGHT);
    const [canvasSizePreset, setCanvasSizePreset] = useState<keyof typeof CANVAS_SIZES>('2R');

    const selectedSlot = photoSlots.find((s) => s.id === selectedSlotId);

    const detectImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = reject;
            img.src = url;
        });
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder', 'frames');

            const response = await fetch(getApiUrl('/api/upload'), { method: 'POST', credentials: 'include', body: formData });
            const data = await response.json();

            if (data.success) {
                setImageUrl(data.url);
                try {
                    const dimensions = await detectImageDimensions(data.url);
                    setCanvasWidth(dimensions.width);
                    setCanvasHeight(dimensions.height);
                    toast.success(`Uploaded! Canvas: ${dimensions.width}×${dimensions.height}px`);
                } catch {
                    toast.success('Frame uploaded');
                }
            } else {
                toast.error(data.error || 'Upload failed');
            }
        } catch (err) {
            toast.error('Failed to upload');
            console.error(err);
        } finally {
            setIsUploading(false);
        }
    };

    const addPhotoSlot = () => {
        const newSlot: PhotoSlot = {
            id: `slot_${Date.now()}`,
            x: 100,
            y: 40,
            width: 800,
            height: 250,
            rotation: 0,
            layer: 'below',
        };
        setPhotoSlots([...photoSlots, newSlot]);
        setSelectedSlotId(newSlot.id);
    };

    const updateSlot = (id: string, updates: Partial<PhotoSlot>) => {
        setPhotoSlots(photoSlots.map((slot) => (slot.id === id ? { ...slot, ...updates } : slot)));
    };

    const removeSlot = (id: string) => {
        setPhotoSlots(photoSlots.filter((slot) => slot.id !== id));
        if (selectedSlotId === id) setSelectedSlotId(null);
    };

    const handleCanvasSizeChange = (preset: keyof typeof CANVAS_SIZES) => {
        setCanvasSizePreset(preset);
        setCanvasWidth(CANVAS_SIZES[preset].width);
        setCanvasHeight(CANVAS_SIZES[preset].height);
    };

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error('Please enter a frame name');
            return;
        }
        if (!imageUrl) {
            toast.error('Please upload a frame image');
            return;
        }
        if (photoSlots.length === 0) {
            toast.error('Please add at least one photo slot');
            return;
        }

        setIsSaving(true);
        try {
            await onSave({
                id: frame?.id,
                name,
                image_url: imageUrl,
                photo_slots: photoSlots,
                is_active: isActive,
                canvas_width: canvasWidth,
                canvas_height: canvasHeight,
            });
            toast.success('Frame saved');
        } catch (err) {
            toast.error('Failed to save');
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    // Calculate preview dimensions
    const maxPreviewHeight = 500;
    const aspectRatio = canvasWidth / canvasHeight;
    const previewHeight = maxPreviewHeight;
    const previewWidth = Math.round(maxPreviewHeight * aspectRatio);

    return (
        <div className="flex gap-8">
            {/* LEFT - Canvas Preview (larger) */}
            <div className="flex-shrink-0">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-muted-foreground">Frame Preview</h3>
                    <Button variant="outline" size="sm" onClick={addPhotoSlot} className="text-xs">
                        <Plus className="w-3 h-3 mr-1" />
                        Add Slot
                    </Button>
                </div>

                <div
                    className="relative bg-gray-100 rounded-lg overflow-hidden border-2 border-dashed border-gray-200"
                    style={{ width: `${previewWidth}px`, height: `${previewHeight}px` }}
                >
                    {imageUrl ? (
                        <img
                            src={imageUrl}
                            alt="Frame"
                            className="absolute inset-0 w-full h-full object-contain z-10 pointer-events-none"
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                            <div className="text-center">
                                <Upload className="w-10 h-10 mx-auto mb-2 opacity-40" />
                                <p className="text-sm">Upload a frame image</p>
                            </div>
                        </div>
                    )}

                    {/* Photo slots */}
                    {photoSlots.map((slot, index) => (
                        <div
                            key={slot.id}
                            onClick={() => setSelectedSlotId(slot.id)}
                            className={`absolute cursor-pointer transition-all border-2 z-20 ${selectedSlotId === slot.id
                                ? 'border-primary bg-primary/20'
                                : slot.layer === 'above'
                                    ? 'border-blue-500 bg-blue-300/30 hover:border-blue-600'
                                    : 'border-gray-400 bg-gray-300/50 hover:border-gray-500'
                                }`}
                            style={{
                                left: `${(slot.x / 1000) * 100}%`,
                                top: `${(slot.y / 1000) * 100}%`,
                                width: `${(slot.width / 1000) * 100}%`,
                                height: `${(slot.height / 1000) * 100}%`,
                                transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                            }}
                        >
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className={`text-lg font-bold ${slot.layer === 'above' ? 'text-blue-600' : 'text-gray-600'}`}>
                                    {index + 1}
                                    {slot.layer === 'above' && <span className="text-xs ml-1">↑</span>}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                <p className="mt-2 text-xs text-muted-foreground text-center">
                    {canvasWidth} × {canvasHeight}px • {photoSlots.length} slot{photoSlots.length !== 1 ? 's' : ''}
                </p>
            </div>

            {/* RIGHT - Settings Panel */}
            <div className="flex-1 min-w-[320px] max-w-[400px]">
                <div className="space-y-6">
                    {/* Basic Info Section */}
                    <section>
                        <h3 className="text-sm font-semibold text-foreground mb-4 pb-2 border-b">
                            Basic Information
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="name" className="text-xs text-muted-foreground">Frame Name</Label>
                                <Input
                                    id="name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g., Classic Strip"
                                    className="mt-1"
                                />
                            </div>

                            <div>
                                <Label className="text-xs text-muted-foreground">Frame Image (PNG)</Label>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                                <Button
                                    variant="outline"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                    className="w-full mt-1"
                                >
                                    {isUploading ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <Upload className="w-4 h-4 mr-2" />
                                    )}
                                    {imageUrl ? 'Change Image' : 'Upload Image'}
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* Canvas Size Section */}
                    <section>
                        <h3 className="text-sm font-semibold text-foreground mb-4 pb-2 border-b">
                            Canvas Size
                        </h3>
                        <div className="grid grid-cols-3 gap-2">
                            {(Object.keys(CANVAS_SIZES) as Array<keyof typeof CANVAS_SIZES>).map((key) => (
                                <Button
                                    key={key}
                                    variant={canvasSizePreset === key ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => handleCanvasSizeChange(key)}
                                    className="text-xs"
                                >
                                    {CANVAS_SIZES[key].label}
                                </Button>
                            ))}
                        </div>
                    </section>

                    {/* Selected Slot Section */}
                    {selectedSlot && (
                        <section>
                            <div className="flex items-center justify-between mb-4 pb-2 border-b">
                                <h3 className="text-sm font-semibold text-foreground">
                                    Slot {photoSlots.findIndex((s) => s.id === selectedSlotId) + 1}
                                </h3>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removeSlot(selectedSlot.id)}
                                    className="text-destructive hover:text-destructive h-7 px-2"
                                >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    Remove
                                </Button>
                            </div>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <Label className="text-xs text-muted-foreground">X Position</Label>
                                            <span className="text-xs font-mono">{selectedSlot.x}</span>
                                        </div>
                                        <Slider
                                            value={[selectedSlot.x]}
                                            min={0}
                                            max={1000}
                                            step={10}
                                            onValueChange={([v]) => updateSlot(selectedSlot.id, { x: v })}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <Label className="text-xs text-muted-foreground">Y Position</Label>
                                            <span className="text-xs font-mono">{selectedSlot.y}</span>
                                        </div>
                                        <Slider
                                            value={[selectedSlot.y]}
                                            min={0}
                                            max={1000}
                                            step={10}
                                            onValueChange={([v]) => updateSlot(selectedSlot.id, { y: v })}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <Label className="text-xs text-muted-foreground">Width</Label>
                                            <span className="text-xs font-mono">{selectedSlot.width}</span>
                                        </div>
                                        <Slider
                                            value={[selectedSlot.width]}
                                            min={50}
                                            max={800}
                                            step={10}
                                            onValueChange={([v]) => updateSlot(selectedSlot.id, { width: v })}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <Label className="text-xs text-muted-foreground">Height</Label>
                                            <span className="text-xs font-mono">{selectedSlot.height}</span>
                                        </div>
                                        <Slider
                                            value={[selectedSlot.height]}
                                            min={50}
                                            max={800}
                                            step={10}
                                            onValueChange={([v]) => updateSlot(selectedSlot.id, { height: v })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <Label className="text-xs text-muted-foreground">Rotation</Label>
                                        <span className="text-xs font-mono">{selectedSlot.rotation || 0}°</span>
                                    </div>
                                    <Slider
                                        value={[selectedSlot.rotation || 0]}
                                        min={-180}
                                        max={180}
                                        step={5}
                                        onValueChange={([v]) => updateSlot(selectedSlot.id, { rotation: v })}
                                    />
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t">
                                    <div>
                                        <Label className="text-xs text-muted-foreground">Layer Position</Label>
                                        <p className="text-xs text-muted-foreground/70">Photo renders above or below frame</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button
                                            variant={selectedSlot.layer !== 'above' ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => updateSlot(selectedSlot.id, { layer: 'below' })}
                                            className="text-xs h-7 px-2"
                                        >
                                            Below
                                        </Button>
                                        <Button
                                            variant={selectedSlot.layer === 'above' ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => updateSlot(selectedSlot.id, { layer: 'above' })}
                                            className="text-xs h-7 px-2"
                                        >
                                            Above
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Visibility Section */}
                    <section>
                        <div className="flex items-center justify-between py-3 border-t border-b">
                            <div>
                                <p className="text-sm font-medium">Show to Customers</p>
                                <p className="text-xs text-muted-foreground">Make this frame available</p>
                            </div>
                            <Switch checked={isActive} onCheckedChange={setIsActive} />
                        </div>
                    </section>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4">
                        <Button variant="outline" onClick={onCancel} className="flex-1">
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving} className="flex-1">
                            {isSaving ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4 mr-2" />
                            )}
                            Save Frame
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
