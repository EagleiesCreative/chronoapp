import { motion } from 'framer-motion';
import { Camera as CameraIcon, RotateCcw } from 'lucide-react';
import { Frame } from '@/lib/supabase';
import { getAssetUrl } from '@/lib/api';

interface CapturedPhoto {
    index: number;
    dataUrl: string;
}

interface PhotoSlotGridProps {
    selectedFrame: Frame | null;
    capturedPhotos: CapturedPhoto[];
    currentPhotoIndex: number;
    lastCapturedPhoto: string | null;
    cachedOverlayUrl: string | null;
    retakingIndex?: number | null;
    onRetakeSlot?: (index: number) => void;
}

function SlotContent({
    originalIndex,
    capturedPhotos,
    currentPhotoIndex,
    lastCapturedPhoto,
    retakingIndex,
    onRetakeSlot,
}: {
    originalIndex: number;
    capturedPhotos: CapturedPhoto[];
    currentPhotoIndex: number;
    lastCapturedPhoto: string | null;
    retakingIndex?: number | null;
    onRetakeSlot?: (index: number) => void;
}) {
    const isRetaking = retakingIndex === originalIndex;
    const isCaptured = !!capturedPhotos[originalIndex];
    const isCurrentSlot = originalIndex === currentPhotoIndex;

    if (isRetaking) {
        return (
            <motion.div
                className="w-full h-full bg-orange-500/20 flex items-center justify-center"
                animate={{ opacity: [0.5, 0.9, 0.5] }}
                transition={{ repeat: Infinity, duration: 1 }}
            >
                <RotateCcw className="w-5 h-5 text-orange-500" strokeWidth={2} />
            </motion.div>
        );
    }

    if (isCaptured) {
        return (
            <div className="relative w-full h-full group" onClick={() => onRetakeSlot?.(originalIndex)}>
                <img
                    src={capturedPhotos[originalIndex].dataUrl}
                    alt={`Photo ${originalIndex + 1}`}
                    className="w-full h-full object-cover"
                />
                {onRetakeSlot && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center cursor-pointer">
                        <RotateCcw className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={2} />
                    </div>
                )}
            </div>
        );
    }

    if (isCurrentSlot && lastCapturedPhoto) {
        return (
            <img
                src={lastCapturedPhoto}
                alt="Preview"
                className="w-full h-full object-cover"
            />
        );
    }

    if (isCurrentSlot) {
        return (
            <motion.div
                className="w-full h-full bg-primary/10 flex items-center justify-center"
                animate={{ opacity: [0.5, 0.8, 0.5] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
            >
                <CameraIcon className="w-5 h-5 text-primary" strokeWidth={1.5} />
            </motion.div>
        );
    }

    return (
        <div className="w-full h-full bg-muted flex items-center justify-center">
            <span className="text-muted-foreground text-xs">{originalIndex + 1}</span>
        </div>
    );
}

export function PhotoSlotGrid({
    selectedFrame,
    capturedPhotos,
    currentPhotoIndex,
    lastCapturedPhoto,
    cachedOverlayUrl,
    retakingIndex,
    onRetakeSlot,
}: PhotoSlotGridProps) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center">
            <div className="elegant-card p-4 rounded-xl">
                <p className="text-center text-xs text-muted-foreground mb-3 font-light tracking-wide">
                    {retakingIndex !== null && retakingIndex !== undefined
                        ? `Retaking photo ${retakingIndex + 1}`
                        : 'Preview'}
                </p>

                {/* Frame with photo slots */}
                {(() => {
                    const cw = selectedFrame?.canvas_width || 600;
                    const ch = selectedFrame?.canvas_height || 1050;
                    const maxH = 380;
                    const scale = maxH / ch;
                    const pw = Math.round(cw * scale);
                    const ph = maxH;
                    return (
                        <div className="relative overflow-hidden" style={{ width: `${pw}px`, height: `${ph}px` }}>
                            {/* Photo slots - layer below or default */}
                            {selectedFrame?.photo_slots?.filter(slot => slot.layer !== 'above').map((slot) => {
                                const originalIndex = selectedFrame.photo_slots!.indexOf(slot);
                                return (
                                    <div
                                        key={slot.id}
                                        className={`absolute overflow-hidden z-0 ${retakingIndex === originalIndex ? 'ring-2 ring-orange-500 rounded-sm' : ''}`}
                                        style={{
                                            left: `${(slot.x / 1000) * 100}%`,
                                            top: `${(slot.y / 1000) * 100}%`,
                                            width: `${(slot.width / 1000) * 100}%`,
                                            height: `${(slot.height / 1000) * 100}%`,
                                            transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                        }}
                                    >
                                        <SlotContent
                                            originalIndex={originalIndex}
                                            capturedPhotos={capturedPhotos}
                                            currentPhotoIndex={currentPhotoIndex}
                                            lastCapturedPhoto={lastCapturedPhoto}
                                            retakingIndex={retakingIndex}
                                            onRetakeSlot={onRetakeSlot}
                                        />
                                    </div>
                                );
                            })}

                            {/* Frame overlay */}
                            {selectedFrame && (
                                <img
                                    src={cachedOverlayUrl || getAssetUrl(selectedFrame.image_url)}
                                    alt="Frame"
                                    className="absolute inset-0 w-full h-full object-contain z-10 pointer-events-none"
                                />
                            )}

                            {/* Photo slots - layer above */}
                            {selectedFrame?.photo_slots?.filter(slot => slot.layer === 'above').map((slot) => {
                                const originalIndex = selectedFrame.photo_slots!.indexOf(slot);
                                return (
                                    <div
                                        key={slot.id}
                                        className={`absolute overflow-hidden z-20 ${retakingIndex === originalIndex ? 'ring-2 ring-orange-500 rounded-sm' : ''}`}
                                        style={{
                                            left: `${(slot.x / 1000) * 100}%`,
                                            top: `${(slot.y / 1000) * 100}%`,
                                            width: `${(slot.width / 1000) * 100}%`,
                                            height: `${(slot.height / 1000) * 100}%`,
                                            transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                                        }}
                                    >
                                        <SlotContent
                                            originalIndex={originalIndex}
                                            capturedPhotos={capturedPhotos}
                                            currentPhotoIndex={currentPhotoIndex}
                                            lastCapturedPhoto={lastCapturedPhoto}
                                            retakingIndex={retakingIndex}
                                            onRetakeSlot={onRetakeSlot}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>

            {/* Captured photos thumbnails — tappable for retake */}
            {capturedPhotos.length > 0 && (
                <div className="flex gap-2 mt-4">
                    {capturedPhotos.map((photo, index) => (
                        <motion.div
                            key={index}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className={`w-14 h-14 rounded-lg overflow-hidden border elegant-shadow cursor-pointer relative group ${retakingIndex === index ? 'border-orange-500 ring-2 ring-orange-500' : 'border-border'}`}
                            onClick={() => onRetakeSlot?.(index)}
                        >
                            <img
                                src={photo.dataUrl}
                                alt={`Captured ${index + 1}`}
                                className="w-full h-full object-cover"
                            />
                            {onRetakeSlot && (
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                                    <RotateCcw className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={2} />
                                </div>
                            )}
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
}
