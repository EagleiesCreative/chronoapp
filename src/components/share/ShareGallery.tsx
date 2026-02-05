'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronLeft,
    ChevronRight,
    Download,
    Share2,
    Check,
    MoreHorizontal,
    Film,
    Image
} from 'lucide-react';

interface ShareGalleryProps {
    sessionId: string;
    eventName: string;
    frameName: string;
    photos: string[]; // First photo is the composite strip, rest are individual photos
    videoUrl?: string | null;
    createdAt: string;
}

export function ShareGallery({
    sessionId,
    eventName,
    frameName,
    photos,
    videoUrl,
    createdAt
}: ShareGalleryProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [viewMode, setViewMode] = useState<'strip' | 'individual' | 'video'>('strip');

    // First photo is the composite strip, rest are individual photos
    const stripImage = photos[0];
    const individualPhotos = photos.slice(1);
    const totalPhotos = photos.length;

    // Current photo being viewed (strip or individual)
    const currentPhoto = viewMode === 'strip' ? stripImage : individualPhotos[currentIndex] || stripImage;

    const goNext = () => {
        if (viewMode === 'individual' && individualPhotos.length > 1) {
            setCurrentIndex((prev) => (prev + 1) % individualPhotos.length);
        }
    };

    const goPrev = () => {
        if (viewMode === 'individual' && individualPhotos.length > 1) {
            setCurrentIndex((prev) => (prev - 1 + individualPhotos.length) % individualPhotos.length);
        }
    };

    const handleDownload = async (url?: string) => {
        const downloadUrl = url || currentPhoto;
        if (!downloadUrl || isDownloading) return;

        setIsDownloading(true);
        try {
            const response = await fetch(downloadUrl);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            const suffix = viewMode === 'strip' ? 'strip' : `photo_${currentIndex + 1}`;
            link.download = `${eventName.replace(/\s+/g, '_')}_${suffix}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error('Download failed:', error);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDownloadVideo = async () => {
        if (!videoUrl || isDownloading) return;

        setIsDownloading(true);
        try {
            const response = await fetch(videoUrl);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `${eventName.replace(/\s+/g, '_')}_animation.gif`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error('Download failed:', error);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleShare = async () => {
        const shareUrl = window.location.href;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: `${eventName} Photos`,
                    text: `Check out my photos from ${eventName}!`,
                    url: shareUrl,
                });
            } catch (err) {
                // User cancelled or error
            }
        } else {
            try {
                await navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } catch (err) {
                console.error('Copy failed:', err);
            }
        }
    };

    const handleDownloadAll = async () => {
        setIsDownloading(true);
        try {
            // Download photos
            for (let i = 0; i < photos.length; i++) {
                const response = await fetch(photos[i]);
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                const suffix = i === 0 ? 'strip' : `photo_${i}`;
                link.download = `${eventName.replace(/\s+/g, '_')}_${suffix}.jpg`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            // Also download video if available
            if (videoUrl) {
                const response = await fetch(videoUrl);
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${eventName.replace(/\s+/g, '_')}_animation.gif`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error('Download failed:', error);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="min-h-screen bg-white flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-4 border-b bg-white sticky top-0 z-20">
                <h1 className="text-lg font-medium text-gray-900 truncate max-w-[60%]">
                    {eventName} • {photos.length} Item{photos.length !== 1 ? 's' : ''}
                </h1>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => viewMode === 'video' ? handleDownloadVideo() : handleDownload()}
                        disabled={isDownloading}
                        className="p-2.5 hover:bg-gray-100 rounded-full transition-colors"
                        aria-label="Download"
                    >
                        <Download className="w-5 h-5 text-gray-700" />
                    </button>
                    <button
                        onClick={handleShare}
                        className="p-2.5 hover:bg-gray-100 rounded-full transition-colors"
                        aria-label="Share"
                    >
                        {copied ? (
                            <Check className="w-5 h-5 text-green-600" />
                        ) : (
                            <Share2 className="w-5 h-5 text-gray-700" />
                        )}
                    </button>
                </div>
            </header>

            {/* Main Gallery */}
            <div className="flex-1 flex items-center justify-center relative px-4 py-6 bg-gray-50">
                {/* Navigation - Left */}
                {viewMode === 'individual' && individualPhotos.length > 1 && (
                    <button
                        onClick={goPrev}
                        className="absolute left-2 z-10 p-2 bg-white/80 hover:bg-white rounded-full shadow-sm transition-all"
                        aria-label="Previous photo"
                    >
                        <ChevronLeft className="w-6 h-6 text-gray-600" />
                    </button>
                )}

                {/* Photo/Video Container */}
                <div className="relative max-w-sm w-full">
                    {/* Counter Badge */}
                    <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                        <div className="bg-gray-900/80 text-white text-sm px-3 py-1 rounded-full flex items-center gap-1.5">
                            {viewMode === 'video' ? (
                                <><Film className="w-3.5 h-3.5" /> GIF</>
                            ) : (
                                <>{viewMode === 'strip' ? '1' : currentIndex + 1}/{viewMode === 'strip' ? totalPhotos : individualPhotos.length}</>
                            )}
                        </div>
                        <button className="bg-gray-900/80 text-white p-1.5 rounded-full">
                            <MoreHorizontal className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Main Content */}
                    <AnimatePresence mode="wait">
                        {viewMode === 'video' && videoUrl ? (
                            <motion.div
                                key="gif"
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                transition={{ duration: 0.2 }}
                                className="relative bg-white rounded-xl overflow-hidden shadow-lg"
                            >
                                <img
                                    src={videoUrl}
                                    alt="Animated photo sequence"
                                    className="w-full"
                                    style={{ maxHeight: '60vh', objectFit: 'contain' }}
                                />
                            </motion.div>
                        ) : (
                            <motion.div
                                key={viewMode === 'strip' ? 'strip' : currentIndex}
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                transition={{ duration: 0.2 }}
                                className="relative bg-white rounded-xl overflow-hidden shadow-lg"
                            >
                                <img
                                    src={currentPhoto}
                                    alt={viewMode === 'strip' ? 'Photo strip' : `Photo ${currentIndex + 1}`}
                                    className="w-full"
                                    style={{ maxHeight: '60vh', objectFit: 'contain' }}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Frame Name Label */}
                    <div className="mt-4 bg-white rounded-xl shadow-sm border p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-medium text-gray-900">{frameName}</h3>
                                <p className="text-sm text-gray-500">{eventName}</p>
                            </div>
                            <div className="w-7 h-7 bg-green-500 rounded-full flex items-center justify-center">
                                <span className="text-white text-sm">♥</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Navigation - Right */}
                {viewMode === 'individual' && individualPhotos.length > 1 && (
                    <button
                        onClick={goNext}
                        className="absolute right-2 z-10 p-2 bg-white/80 hover:bg-white rounded-full shadow-sm transition-all"
                        aria-label="Next photo"
                    >
                        <ChevronRight className="w-6 h-6 text-gray-600" />
                    </button>
                )}
            </div>

            {/* Thumbnail Strip */}
            <div className="border-t bg-white py-4 px-4">
                <div className="flex gap-3 overflow-x-auto pb-2 justify-center">
                    {/* Video thumbnail */}
                    {videoUrl && (
                        <>
                            <button
                                onClick={() => { setViewMode('video'); }}
                                className={`flex-shrink-0 rounded-lg overflow-hidden transition-all border-2 relative ${viewMode === 'video'
                                    ? 'border-gray-900 shadow-md'
                                    : 'border-transparent opacity-70 hover:opacity-100'
                                    }`}
                            >
                                <div className="w-16 h-24 bg-gray-900 flex items-center justify-center">
                                    <Film className="w-6 h-6 text-white" />
                                </div>
                            </button>
                            <div className="w-px bg-gray-200 self-stretch my-1" />
                        </>
                    )}

                    {/* Strip thumbnail */}
                    <button
                        onClick={() => { setViewMode('strip'); }}
                        className={`flex-shrink-0 rounded-lg overflow-hidden transition-all border-2 ${viewMode === 'strip'
                            ? 'border-gray-900 shadow-md'
                            : 'border-transparent opacity-70 hover:opacity-100'
                            }`}
                    >
                        <img
                            src={stripImage}
                            alt="Photo strip"
                            className="w-16 h-24 object-cover"
                        />
                    </button>

                    {/* Divider */}
                    {individualPhotos.length > 0 && (
                        <div className="w-px bg-gray-200 self-stretch my-1" />
                    )}

                    {/* Individual photos */}
                    {individualPhotos.map((photo, index) => (
                        <button
                            key={index}
                            onClick={() => { setViewMode('individual'); setCurrentIndex(index); }}
                            className={`flex-shrink-0 rounded-lg overflow-hidden transition-all border-2 ${viewMode === 'individual' && index === currentIndex
                                ? 'border-gray-900 shadow-md'
                                : 'border-transparent opacity-70 hover:opacity-100'
                                }`}
                        >
                            <img
                                src={photo}
                                alt={`Photo ${index + 1}`}
                                className="w-16 h-20 object-cover"
                            />
                        </button>
                    ))}
                </div>
            </div>

            {/* Bottom Action Bar */}
            <div className="border-t bg-white p-4 safe-area-bottom">
                <div className="max-w-sm mx-auto flex flex-col gap-4">
                    {/* Explicit Download Options */}
                    <div className="grid grid-cols-1 gap-2">
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-1 px-1">Download Options</p>

                        {/* Download Photo Strip */}
                        <button
                            onClick={() => handleDownload(stripImage)}
                            className="flex items-center justify-between w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white rounded-lg shadow-sm group-hover:shadow transition-all">
                                    <Image className="w-4 h-4 text-blue-500" />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-medium text-gray-900">Photo Strip</p>
                                    <p className="text-xs text-gray-500">The complete frame</p>
                                </div>
                            </div>
                            <Download className="w-4 h-4 text-gray-400 group-hover:text-gray-900 transition-colors" />
                        </button>

                        {/* Download GIF */}
                        {videoUrl && (
                            <button
                                onClick={handleDownloadVideo}
                                className="flex items-center justify-between w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white rounded-lg shadow-sm group-hover:shadow transition-all">
                                        <Film className="w-4 h-4 text-purple-500" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-medium text-gray-900">Stop-motion GIF</p>
                                        <p className="text-xs text-gray-500">Animated sequence</p>
                                    </div>
                                </div>
                                <Download className="w-4 h-4 text-gray-400 group-hover:text-gray-900 transition-colors" />
                            </button>
                        )}

                        {/* Individual Photos */}
                        {individualPhotos.map((photo, index) => (
                            <button
                                key={index}
                                onClick={() => handleDownload(photo)}
                                className="flex items-center justify-between w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white rounded-lg shadow-sm group-hover:shadow transition-all overflow-hidden w-10 h-10 flex items-center justify-center">
                                        <img src={photo} alt={`Photo ${index + 1}`} className="w-full h-full object-cover rounded-sm" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-medium text-gray-900">Photo {index + 1}</p>
                                        <p className="text-xs text-gray-500">Original capture</p>
                                    </div>
                                </div>
                                <Download className="w-4 h-4 text-gray-400 group-hover:text-gray-900 transition-colors" />
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center justify-center gap-3">
                        <button
                            onClick={handleDownloadAll}
                            disabled={isDownloading}
                            className="flex-1 flex items-center justify-center gap-2 bg-gray-900 text-white py-3.5 px-6 rounded-full font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
                        >
                            <Download className="w-5 h-5" />
                            {isDownloading ? 'Downloading...' : 'Download All'}
                        </button>
                        <button
                            onClick={handleShare}
                            className="p-3.5 border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
                        >
                            <Share2 className="w-5 h-5 text-gray-700" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Powered By Footer */}
            <div className="text-center py-3 border-t bg-gray-50">
                <p className="text-xs text-gray-400">
                    Powered by <span className="font-medium">ChronoSnap</span>
                </p>
            </div>
        </div>
    );
}

