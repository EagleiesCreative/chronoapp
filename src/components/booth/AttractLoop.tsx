'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';

interface FloatingPhotoData {
    id: number;
    x: number;
    y: number;
    size: number;
    dx: number;
    dy: number;
    rotation: number;
    opacity: number;
}

interface AttractLoopProps {
    recentPhotos?: string[];
    showParticles?: boolean;
    attractText?: string;
}

function generateParticles(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 8,
        duration: 6 + Math.random() * 6,
        size: 3 + Math.random() * 6,
        opacity: 0.15 + Math.random() * 0.25,
    }));
}

export function AttractLoop({ recentPhotos = [], showParticles = true, attractText = 'Tap to Start!' }: AttractLoopProps) {
    const particles = useMemo(() => generateParticles(20), []);

    // Floating photos with random initial positions
    const floatingPhotos = useMemo<FloatingPhotoData[]>(() => {
        if (recentPhotos.length === 0) return [];
        return recentPhotos.slice(0, 8).map((_, i) => ({
            id: i,
            x: 10 + Math.random() * 80,
            y: 10 + Math.random() * 80,
            size: 80 + Math.random() * 60,
            dx: (Math.random() - 0.5) * 30,
            dy: (Math.random() - 0.5) * 30,
            rotation: (Math.random() - 0.5) * 20,
            opacity: 0.35 + Math.random() * 0.25,
        }));
    }, [recentPhotos]);

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            {/* Bokeh particles */}
            {showParticles && particles.map((p) => (
                <motion.div
                    key={`particle-${p.id}`}
                    className="absolute rounded-full"
                    style={{
                        left: `${p.left}%`,
                        bottom: '-10px',
                        width: p.size,
                        height: p.size,
                        background: `radial-gradient(circle, rgba(255,255,255,${p.opacity}) 0%, transparent 70%)`,
                    }}
                    animate={{
                        y: [0, -window.innerHeight - 20],
                        x: [0, (Math.random() - 0.5) * 50],
                        opacity: [0, p.opacity, p.opacity, 0],
                    }}
                    transition={{
                        duration: p.duration,
                        delay: p.delay,
                        repeat: Infinity,
                        ease: 'linear',
                    }}
                />
            ))}

            {/* Floating recent photos */}
            {floatingPhotos.map((photo, i) => (
                <motion.div
                    key={`float-${photo.id}`}
                    className="absolute rounded-2xl overflow-hidden shadow-xl"
                    style={{
                        width: photo.size,
                        height: photo.size,
                        left: `${photo.x}%`,
                        top: `${photo.y}%`,
                    }}
                    animate={{
                        x: [0, photo.dx, -photo.dx, 0],
                        y: [0, photo.dy, -photo.dy, 0],
                        rotate: [0, photo.rotation, -photo.rotation, 0],
                        opacity: [photo.opacity, photo.opacity * 1.2, photo.opacity],
                    }}
                    transition={{
                        duration: 12 + i * 2,
                        repeat: Infinity,
                        ease: 'easeInOut',
                    }}
                >
                    <img
                        src={recentPhotos[i]}
                        alt=""
                        className="w-full h-full object-cover"
                        style={{ opacity: photo.opacity }}
                    />
                </motion.div>
            ))}

            {/* CTA Pulse */}
            {attractText && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                    <motion.div
                        animate={{ scale: [1, 1.04, 1] }}
                        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    >
                        <p className="text-4xl md:text-5xl font-light text-white/70 text-shadow-dark tracking-wide select-none">
                            {attractText}
                        </p>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
