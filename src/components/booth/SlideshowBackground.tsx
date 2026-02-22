'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '@/lib/api';

export function SlideshowBackground() {
    const [photos, setPhotos] = useState<string[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Fetch recent photos on mount and then poll every minute
    useEffect(() => {
        const fetchPhotos = async () => {
            try {
                const res = await apiFetch('/api/booth/recent-photos?limit=20');
                if (res.ok) {
                    const data = await res.json();
                    if (data.photos && data.photos.length > 0) {
                        setPhotos(data.photos);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch slideshow photos', err);
            }
        };

        fetchPhotos();
        const pollInterval = setInterval(fetchPhotos, 60000); // refresh every minute
        return () => clearInterval(pollInterval);
    }, []);

    // Rotate photos every 5 seconds
    useEffect(() => {
        if (photos.length <= 1) return;

        const rotateInterval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % photos.length);
        }, 5000);

        return () => clearInterval(rotateInterval);
    }, [photos.length]);

    if (photos.length === 0) return null;

    return (
        <div className="absolute inset-0 z-0 overflow-hidden bg-black">
            <AnimatePresence initial={false}>
                <motion.img
                    key={currentIndex}
                    src={photos[currentIndex]}
                    alt="Slideshow"
                    initial={{ opacity: 0, scale: 1.05 }}
                    animate={{ opacity: 0.4, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.5, ease: "easeInOut" }}
                    className="absolute inset-0 w-full h-full object-cover"
                />
            </AnimatePresence>
        </div>
    );
}
