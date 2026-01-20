'use client';

import { useState, useRef } from 'react';
import { Image, Palette, Upload, X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useTenantStore } from '@/store/tenant-store';
import { toast } from 'sonner';
import { getApiUrl } from '@/lib/api';

const PRESET_COLORS = [
    '#ffffff', // White
    '#f8fafc', // Slate 50
    '#1e293b', // Slate 800
    '#0f172a', // Slate 900
    '#7c3aed', // Violet 600
    '#2563eb', // Blue 600
    '#059669', // Emerald 600
    '#dc2626', // Red 600
];

export function BackgroundSettings() {
    const { booth, setBooth } = useTenantStore();
    const [isUploading, setIsUploading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedColor, setSelectedColor] = useState(booth?.background_color || '#ffffff');
    const [backgroundImage, setBackgroundImage] = useState(booth?.background_image || '');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleColorChange = (color: string) => {
        setSelectedColor(color);
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file');
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image must be less than 5MB');
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder', 'backgrounds');

            const response = await fetch(getApiUrl('/api/upload'), {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();
            if (data.success && data.url) {
                setBackgroundImage(data.url);
                toast.success('Image uploaded');
            } else {
                toast.error(data.error || 'Upload failed');
            }
        } catch (error) {
            console.error('Upload error:', error);
            toast.error('Failed to upload image');
        } finally {
            setIsUploading(false);
        }
    };

    const handleRemoveImage = () => {
        setBackgroundImage('');
    };

    const handleSave = async () => {
        if (!booth) {
            toast.error('No booth selected');
            return;
        }

        setIsSaving(true);
        try {
            const response = await fetch(getApiUrl('/api/booth/settings'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booth_id: booth.id,
                    background_image: backgroundImage || null,
                    background_color: selectedColor,
                }),
            });

            const data = await response.json();
            if (data.success) {
                // Update local state
                setBooth({
                    ...booth,
                    background_image: backgroundImage || undefined,
                    background_color: selectedColor,
                });
                toast.success('Background settings saved');
            } else {
                toast.error(data.error || 'Failed to save settings');
            }
        } catch (error) {
            console.error('Save error:', error);
            toast.error('Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="glass-card">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Image className="w-5 h-5" />
                    Idle Screen Background
                </CardTitle>
                <CardDescription>
                    Customize the background of your booth&apos;s idle screen
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Background Image */}
                <div className="space-y-3">
                    <label className="text-sm font-medium">Background Image</label>

                    {backgroundImage ? (
                        <div className="relative rounded-lg overflow-hidden aspect-video bg-muted">
                            <img
                                src={backgroundImage}
                                alt="Background preview"
                                className="w-full h-full object-cover"
                            />
                            <Button
                                variant="destructive"
                                size="icon"
                                className="absolute top-2 right-2"
                                onClick={handleRemoveImage}
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    ) : (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                        >
                            {isUploading ? (
                                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-muted-foreground" />
                            ) : (
                                <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                            )}
                            <p className="text-sm text-muted-foreground">
                                {isUploading ? 'Uploading...' : 'Click to upload background image'}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                JPEG, PNG up to 5MB
                            </p>
                        </div>
                    )}

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                    />
                </div>

                {/* Background Color */}
                <div className="space-y-3">
                    <label className="text-sm font-medium flex items-center gap-2">
                        <Palette className="w-4 h-4" />
                        Background Color
                        {backgroundImage && (
                            <span className="text-xs text-muted-foreground">(used if no image)</span>
                        )}
                    </label>

                    <div className="flex flex-wrap gap-2">
                        {PRESET_COLORS.map((color) => (
                            <button
                                key={color}
                                onClick={() => handleColorChange(color)}
                                className={`w-10 h-10 rounded-lg border-2 transition-all ${selectedColor === color
                                    ? 'border-primary scale-110 ring-2 ring-primary/30'
                                    : 'border-transparent hover:border-muted-foreground/30'
                                    }`}
                                style={{ backgroundColor: color }}
                            />
                        ))}

                        {/* Custom color picker */}
                        <div className="relative">
                            <input
                                type="color"
                                value={selectedColor}
                                onChange={(e) => handleColorChange(e.target.value)}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                            <div
                                className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center ${!PRESET_COLORS.includes(selectedColor)
                                    ? 'border-primary'
                                    : 'border-dashed border-muted-foreground/30'
                                    }`}
                                style={{ backgroundColor: selectedColor }}
                            >
                                <Palette className="w-4 h-4 text-muted-foreground mix-blend-difference" />
                            </div>
                        </div>
                    </div>

                    {/* Current color */}
                    <div className="flex items-center gap-2">
                        <div
                            className="w-6 h-6 rounded border"
                            style={{ backgroundColor: selectedColor }}
                        />
                        <Input
                            value={selectedColor}
                            onChange={(e) => handleColorChange(e.target.value)}
                            className="w-28 font-mono text-sm"
                            placeholder="#ffffff"
                        />
                    </div>
                </div>

                {/* Preview */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">Preview</label>
                    <div
                        className="rounded-lg h-32 flex items-center justify-center relative overflow-hidden"
                        style={
                            backgroundImage
                                ? { backgroundImage: `url(${backgroundImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                                : { backgroundColor: selectedColor }
                        }
                    >
                        {backgroundImage && <div className="absolute inset-0 bg-black/30" />}
                        <span className={`text-lg font-light relative z-10 ${backgroundImage || selectedColor === '#0f172a' || selectedColor === '#1e293b' ? 'text-white' : 'text-foreground'}`}>
                            ChronoSnap
                        </span>
                    </div>
                </div>

                {/* Save Button */}
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full"
                >
                    {isSaving ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Check className="w-4 h-4 mr-2" />
                            Save Background Settings
                        </>
                    )}
                </Button>
            </CardContent>
        </Card>
    );
}
