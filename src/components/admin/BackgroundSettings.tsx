'use client';

import { useState, useRef, useEffect } from 'react';
import { Image, Palette, Upload, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FloatingSaveBar } from '@/components/ui/floating-save-bar';
import { apiFetch } from '@/lib/api';
import { useTenantStore } from '@/store/tenant-store';
import { useAdminStore } from '@/store/booth-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { DEFAULT_EXTRA_PRINT_PRICE } from '@/lib/supabase';
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
    const { activeSession, setActiveSession } = useSessionProfileStore();
    const { isLivePreviewEnabled, setIsLivePreviewEnabled } = useAdminStore();
    const [isUploading, setIsUploading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Read from active session first, then booth fallback
    const [selectedColor, setSelectedColor] = useState(activeSession?.background_color || booth?.background_color || '#ffffff');
    const [backgroundImage, setBackgroundImage] = useState(activeSession?.background_image || booth?.background_image || '');
    const [paymentBypass, setPaymentBypass] = useState(activeSession?.payment_bypass ?? booth?.payment_bypass ?? false);
    const [countdownSeconds, setCountdownSeconds] = useState(activeSession?.countdown_seconds ?? booth?.countdown_seconds ?? 3);
    const [previewSeconds, setPreviewSeconds] = useState(activeSession?.preview_seconds ?? booth?.preview_seconds ?? 5);
    const [liveVideoSeconds, setLiveVideoSeconds] = useState(activeSession?.live_video_seconds ?? booth?.live_video_seconds ?? 3);
    const [reviewTimeoutSeconds, setReviewTimeoutSeconds] = useState(activeSession?.review_timeout_seconds ?? booth?.review_timeout_seconds ?? 60);
    const [printCopies, setPrintCopies] = useState(activeSession?.print_copies ?? booth?.print_copies ?? 1);
    const [slideshowEnabled, setSlideshowEnabled] = useState(activeSession?.slideshow_enabled ?? booth?.slideshow_enabled ?? false);
    // Extra print is booth-level only (booth_sessions has no such columns).
    const [extraPrintEnabled, setExtraPrintEnabled] = useState(booth?.extra_print_enabled ?? true);
    const [extraPrintPrice, setExtraPrintPrice] = useState(booth?.extra_print_price ?? DEFAULT_EXTRA_PRINT_PRICE);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [tempLivePreviewEnabled, setTempLivePreviewEnabled] = useState(isLivePreviewEnabled);

    // Sync form state when active session changes
    useEffect(() => {
        setSelectedColor(activeSession?.background_color || booth?.background_color || '#ffffff');
        setBackgroundImage(activeSession?.background_image || booth?.background_image || '');
        setPaymentBypass(activeSession?.payment_bypass ?? booth?.payment_bypass ?? false);
        setCountdownSeconds(activeSession?.countdown_seconds ?? booth?.countdown_seconds ?? 3);
        setPreviewSeconds(activeSession?.preview_seconds ?? booth?.preview_seconds ?? 5);
        setLiveVideoSeconds(activeSession?.live_video_seconds ?? booth?.live_video_seconds ?? 3);
        setReviewTimeoutSeconds(activeSession?.review_timeout_seconds ?? booth?.review_timeout_seconds ?? 60);
        setPrintCopies(activeSession?.print_copies ?? booth?.print_copies ?? 1);
        setSlideshowEnabled(activeSession?.slideshow_enabled ?? booth?.slideshow_enabled ?? false);
        setExtraPrintEnabled(booth?.extra_print_enabled ?? true);
        setExtraPrintPrice(booth?.extra_print_price ?? DEFAULT_EXTRA_PRINT_PRICE);
    }, [activeSession?.id]);

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

    // Use the effective source for dirty checking
    const effectiveBgColor = activeSession?.background_color || booth?.background_color || '#ffffff';
    const effectiveBgImage = activeSession?.background_image || booth?.background_image || '';
    const effectivePaymentBypass = activeSession?.payment_bypass ?? booth?.payment_bypass ?? false;
    const effectiveCountdown = activeSession?.countdown_seconds ?? booth?.countdown_seconds ?? 3;
    const effectivePreview = activeSession?.preview_seconds ?? booth?.preview_seconds ?? 5;
    const effectiveLiveVideo = activeSession?.live_video_seconds ?? booth?.live_video_seconds ?? 3;
    const effectiveReviewTimeout = activeSession?.review_timeout_seconds ?? booth?.review_timeout_seconds ?? 60;
    const effectivePrintCopies = activeSession?.print_copies ?? booth?.print_copies ?? 1;
    const effectiveSlideshow = activeSession?.slideshow_enabled ?? booth?.slideshow_enabled ?? false;
    const effectiveExtraPrintEnabled = booth?.extra_print_enabled ?? true;
    const effectiveExtraPrintPrice = booth?.extra_print_price ?? DEFAULT_EXTRA_PRINT_PRICE;

    // Derived state for unsaved changes
    const isDirty =
        extraPrintEnabled !== effectiveExtraPrintEnabled ||
        extraPrintPrice !== effectiveExtraPrintPrice ||
        selectedColor !== effectiveBgColor ||
        backgroundImage !== effectiveBgImage ||
        paymentBypass !== effectivePaymentBypass ||
        countdownSeconds !== effectiveCountdown ||
        previewSeconds !== effectivePreview ||
        liveVideoSeconds !== effectiveLiveVideo ||
        reviewTimeoutSeconds !== effectiveReviewTimeout ||
        printCopies !== effectivePrintCopies ||
        slideshowEnabled !== effectiveSlideshow ||
        tempLivePreviewEnabled !== isLivePreviewEnabled;

    const handleDiscard = () => {
        setSelectedColor(effectiveBgColor);
        setBackgroundImage(effectiveBgImage);
        setPaymentBypass(effectivePaymentBypass);
        setCountdownSeconds(effectiveCountdown);
        setPreviewSeconds(effectivePreview);
        setLiveVideoSeconds(effectiveLiveVideo);
        setReviewTimeoutSeconds(effectiveReviewTimeout);
        setPrintCopies(effectivePrintCopies);
        setSlideshowEnabled(effectiveSlideshow);
        setExtraPrintEnabled(effectiveExtraPrintEnabled);
        setExtraPrintPrice(effectiveExtraPrintPrice);
        setTempLivePreviewEnabled(isLivePreviewEnabled);
    };

    const settingsPayload = {
        background_image: backgroundImage || null,
        background_color: selectedColor,
        payment_bypass: paymentBypass,
        countdown_seconds: countdownSeconds,
        preview_seconds: previewSeconds,
        live_video_seconds: liveVideoSeconds,
        review_timeout_seconds: reviewTimeoutSeconds,
        print_copies: printCopies,
        slideshow_enabled: slideshowEnabled,
    };

    const handleSave = async () => {
        if (!booth) {
            toast.error('No booth selected');
            return;
        }

        setIsSaving(true);
        try {
            // The settings in `settingsPayload` are SESSION-scoped: those columns
            // exist only on `booth_sessions`, and the booth screens read them as
            // `activeSession?.x ?? booth?.x`. So the active session is the source
            // of truth and is saved first; only genuinely booth-wide fields go to
            // the booth record.
            if (activeSession?.id) {
                const sessionRes = await apiFetch(`/api/booth-sessions/${activeSession.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(settingsPayload),
                });
                const sessionResult = await sessionRes.json().catch(() => ({}));
                if (!sessionRes.ok) {
                    toast.error(sessionResult?.error || 'Failed to save session settings');
                    return;
                }
                setActiveSession({ ...activeSession, ...sessionResult.data });
            }

            // Booth-wide settings (these columns really do live on `booths`).
            const response = await apiFetch('/api/booth/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    booth_id: booth.id,
                    live_video_seconds: liveVideoSeconds,
                    extra_print_enabled: extraPrintEnabled,
                    extra_print_price: extraPrintPrice,
                }),
            });

            setIsLivePreviewEnabled(tempLivePreviewEnabled);

            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                toast.error(data.error || 'Failed to save booth settings');
                return;
            }

            setBooth({
                ...booth,
                live_video_seconds: liveVideoSeconds,
                extra_print_enabled: extraPrintEnabled,
                extra_print_price: extraPrintPrice,
            });

            if (activeSession?.id) {
                toast.success(`Settings saved to session "${activeSession.name}"`);
            } else {
                toast.warning('Saved booth-wide settings only — activate a session to save timing, bypass and print settings.');
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
            <Tabs defaultValue="idle" className="w-full mb-20">
                <TabsList className="grid w-full max-w-xl grid-cols-2 mb-6 mx-auto">
                    <TabsTrigger value="idle">Idle Screen</TabsTrigger>
                    <TabsTrigger value="experience">Booth Experience</TabsTrigger>
                </TabsList>

                <TabsContent value="idle">
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

                    {/* Idle Screen Slideshow */}
                    <div className="flex flex-row items-center justify-between rounded-lg border p-4 bg-muted/20">
                        <div className="space-y-0.5">
                            <Label className="text-base font-semibold">Idle Screen Slideshow</Label>
                            <p className="text-sm text-muted-foreground mr-8">
                                Randomly cycle through recently taken photos when the booth is idle.
                            </p>
                        </div>
                        <Switch
                            checked={slideshowEnabled}
                            onCheckedChange={setSlideshowEnabled}
                        />
                    </div>

                    {/* Idle Live Preview */}
                    <div className="flex flex-row items-center justify-between rounded-lg border p-4 bg-muted/20">
                        <div className="space-y-0.5">
                            <Label className="text-base font-semibold">Idle Live Preview Background</Label>
                            <p className="text-sm text-muted-foreground mr-8">
                                Show full-screen live camera preview on the home screen before user starts session.
                            </p>
                        </div>
                        <Switch
                            checked={tempLivePreviewEnabled}
                            onCheckedChange={setTempLivePreviewEnabled}
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
                                Framr Studio
                            </span>
                        </div>
                    </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="experience">
                    <Card className="glass-card">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                Booth Experience
                            </CardTitle>
                            <CardDescription>
                                Configure wait times, auto-continue durations, and print copies
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                    {/* Capture Countdown */}
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <Label className="text-sm font-medium">Capture Countdown ({countdownSeconds}s)</Label>
                            <span className="text-sm text-muted-foreground">Range: 1-10s</span>
                        </div>
                        <Slider
                            min={1}
                            max={10}
                            step={1}
                            value={[countdownSeconds]}
                            onValueChange={(vals) => setCountdownSeconds(vals[0])}
                            className="py-2"
                        />
                        <p className="text-xs text-muted-foreground">Time before each photo is taken.</p>
                    </div>

                    {/* Preview Duration */}
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <Label className="text-sm font-medium">Preview Duration ({previewSeconds}s)</Label>
                            <span className="text-sm text-muted-foreground">Range: 3-15s</span>
                        </div>
                        <Slider
                            min={3}
                            max={15}
                            step={1}
                            value={[previewSeconds]}
                            onValueChange={(vals) => setPreviewSeconds(vals[0])}
                            className="py-2"
                        />
                        <p className="text-xs text-muted-foreground">How long to show the photo preview before automatically continuing.</p>
                    </div>

                    {/* Live Video Duration */}
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <Label className="text-sm font-medium">Live Video Duration ({liveVideoSeconds}s)</Label>
                            <span className="text-sm text-muted-foreground">Range: 2-8s</span>
                        </div>
                        <Slider
                            min={2}
                            max={8}
                            step={1}
                            value={[liveVideoSeconds]}
                            onValueChange={(vals) => setLiveVideoSeconds(vals[0])}
                            className="py-2"
                        />
                        <p className="text-xs text-muted-foreground">Length of the Live Video clip shown and shared in the web gallery. Longer clips make larger files.</p>
                    </div>

                    {/* Review Timeout */}
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <Label className="text-sm font-medium">Review Auto-Reset ({reviewTimeoutSeconds}s)</Label>
                            <span className="text-sm text-muted-foreground">Range: 15-300s</span>
                        </div>
                        <Slider
                            min={15}
                            max={300}
                            step={5}
                            value={[reviewTimeoutSeconds]}
                            onValueChange={(vals) => setReviewTimeoutSeconds(vals[0])}
                            className="py-2"
                        />
                        <p className="text-xs text-muted-foreground">Idle time on the final review screen before resetting to the start.</p>
                    </div>
                    {/* Print Copies */}
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <Label className="text-sm font-medium">Prints Included in Price ({printCopies})</Label>
                            <span className="text-sm text-muted-foreground">Range: 1-5</span>
                        </div>
                        <Slider
                            min={1}
                            max={5}
                            step={1}
                            value={[printCopies]}
                            onValueChange={(vals) => setPrintCopies(vals[0])}
                            className="py-2"
                        />
                        <p className="text-xs text-muted-foreground">Copies covered by the base price. Guests can add more before paying, each charged at the extra print price below.</p>
                    </div>

                    {/* Paid Extra Print */}
                    <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                        <div className="flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base font-semibold">Sell Extra Prints</Label>
                                <p className="text-sm text-muted-foreground mr-8">
                                    Show a &quot;Buy Extra Print&quot; button on the review screen. Guests pay by QRIS before the copy prints.
                                </p>
                            </div>
                            <Switch
                                checked={extraPrintEnabled}
                                onCheckedChange={setExtraPrintEnabled}
                            />
                        </div>

                        {extraPrintEnabled && (
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Price per extra print (IDR)</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    step={1000}
                                    value={extraPrintPrice}
                                    onChange={(e) => setExtraPrintPrice(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                                    className="max-w-xs"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Charged per copy. If Bypass Payment is on, extra prints are free and print immediately.
                                </p>
                            </div>
                        )}
                    </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <FloatingSaveBar
                isVisible={isDirty}
                isSaving={isSaving}
                onSave={handleSave}
                onDiscard={handleDiscard}
            />
        </>
    );
}
