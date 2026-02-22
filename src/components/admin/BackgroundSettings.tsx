'use client';

import { useState, useRef, useEffect } from 'react';
import { Image, Palette, Upload, X, Check, Loader2, HardDrive, FolderOpen, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FloatingSaveBar } from '@/components/ui/floating-save-bar';
import { apiFetch } from '@/lib/api';
import { isTauri, pickSaveDirectory, checkDirectoryWritable } from '@/lib/local-save';
import { useTenantStore } from '@/store/tenant-store';
import { useLocalSaveStore } from '@/store/local-save-store';
import { toast } from 'sonner';

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
    const [paymentBypass, setPaymentBypass] = useState(booth?.payment_bypass || false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Local save state (from persisted store)
    const [showTauri, setShowTauri] = useState(false);
    const { enabled: localSaveStoreEnabled, setEnabled: setLocalSaveStoreEnabled, savePath: localSaveStorePath, setSavePath: setLocalSaveStorePath } = useLocalSaveStore();

    // Component local state for local save settings (to be saved via FloatingSaveBar)
    const [tempLocalSaveEnabled, setTempLocalSaveEnabled] = useState(localSaveStoreEnabled);
    const [tempSavePath, setTempSavePath] = useState<string | null>(localSaveStorePath);

    const [pathStatus, setPathStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');

    // Check if running in Tauri (client-side only)
    useEffect(() => {
        setShowTauri(isTauri());
    }, []);

    // Validate directory when tempSavePath changes
    useEffect(() => {
        if (!tempSavePath || !showTauri) {
            setPathStatus('idle');
            return;
        }
        setPathStatus('checking');
        checkDirectoryWritable(tempSavePath).then((writable) => {
            setPathStatus(writable ? 'ok' : 'error');
        });
    }, [tempSavePath, showTauri]);

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

            const response = await apiFetch('/api/upload', {
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

    // Derived state for unsaved changes
    const isDirty =
        selectedColor !== (booth?.background_color || '#ffffff') ||
        backgroundImage !== (booth?.background_image || '') ||
        paymentBypass !== (booth?.payment_bypass || false) ||
        tempLocalSaveEnabled !== localSaveStoreEnabled ||
        tempSavePath !== localSaveStorePath;

    const handleDiscard = () => {
        setSelectedColor(booth?.background_color || '#ffffff');
        setBackgroundImage(booth?.background_image || '');
        setPaymentBypass(booth?.payment_bypass || false);
        setTempLocalSaveEnabled(localSaveStoreEnabled);
        setTempSavePath(localSaveStorePath);
    };

    const handleSave = async () => {
        if (!booth) {
            toast.error('No booth selected');
            return;
        }

        setIsSaving(true);
        try {
            const response = await apiFetch('/api/booth/settings', { // Changed to apiFetch
                method: 'PATCH', // Kept original method
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    booth_id: booth.id,
                    background_image: backgroundImage || null,
                    background_color: selectedColor,
                    payment_bypass: paymentBypass,
                }),
            });

            // Save local save settings to persisted store
            setLocalSaveStoreEnabled(tempLocalSaveEnabled);
            setLocalSaveStorePath(tempSavePath);

            const data = await response.json();
            if (data.success) {
                // Update local state
                setBooth({
                    ...booth,
                    background_image: backgroundImage || undefined,
                    background_color: selectedColor,
                    payment_bypass: paymentBypass,
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
        <>
            <Card className="glass-card mb-20">
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
                    {/* Payment Bypass */}
                    <div className="flex flex-row items-center justify-between rounded-lg border p-4 bg-muted/20">
                        <div className="space-y-0.5">
                            <Label className="text-base font-semibold">Bypass Payment</Label>
                            <p className="text-sm text-muted-foreground">
                                Skip payment screen. Customers can use the booth for free.
                            </p>
                        </div>
                        <Switch
                            checked={paymentBypass}
                            onCheckedChange={setPaymentBypass}
                        />
                    </div>

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
                </CardContent>
            </Card>

            {/* Local Photo Backup — only in Tauri */}
            {showTauri && (
                <Card className="glass-card">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <HardDrive className="w-5 h-5" />
                            Local Photo Backup
                        </CardTitle>
                        <CardDescription>
                            Save captured photos to a folder on this computer
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Toggle */}
                        <div className="flex flex-row items-center justify-between rounded-lg border p-4 bg-muted/20">
                            <div className="space-y-0.5">
                                <Label className="text-base font-semibold">Save Photos Locally</Label>
                                <p className="text-sm text-muted-foreground">
                                    Keep a local copy of every session&apos;s photos on this computer.
                                </p>
                            </div>
                            <Switch
                                checked={tempLocalSaveEnabled}
                                onCheckedChange={setTempLocalSaveEnabled}
                            />
                        </div>

                        {/* Directory Picker */}
                        {tempLocalSaveEnabled && (
                            <div className="space-y-3">
                                <Label className="text-sm font-medium">Save Directory</Label>
                                <div className="flex gap-2">
                                    <div className="flex-1 relative">
                                        <Input
                                            value={tempSavePath || ''}
                                            onChange={(e) => setTempSavePath(e.target.value || null)}
                                            placeholder="/Users/.../ChronoSnap Photos"
                                            className="pr-8 font-mono text-xs"
                                        />
                                        {pathStatus === 'ok' && (
                                            <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                                        )}
                                        {pathStatus === 'error' && (
                                            <XCircle className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
                                        )}
                                        {pathStatus === 'checking' && (
                                            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                                        )}
                                    </div>
                                    <Button
                                        variant="outline"
                                        onClick={async () => {
                                            const dir = await pickSaveDirectory();
                                            if (dir) {
                                                setTempSavePath(dir);
                                            }
                                        }}
                                    >
                                        <FolderOpen className="w-4 h-4 mr-2" />
                                        Browse
                                    </Button>
                                </div>
                                {pathStatus === 'error' && (
                                    <p className="text-xs text-red-500">Directory is not writable. Please choose a different folder.</p>
                                )}
                                {pathStatus === 'ok' && (
                                    <p className="text-xs text-green-600">✓ Directory is ready. Photos will be saved here.</p>
                                )}
                                {!tempSavePath && (
                                    <p className="text-xs text-muted-foreground">Click Browse to choose where photos will be saved.</p>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <FloatingSaveBar
                isVisible={isDirty}
                isSaving={isSaving}
                onSave={handleSave}
                onDiscard={handleDiscard}
            />
        </>
    );
}
