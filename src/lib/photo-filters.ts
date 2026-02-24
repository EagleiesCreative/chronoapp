// Photo filter definitions for canvas-based rendering

export interface PhotoFilter {
    name: string;
    label: string;
    cssFilter: string;         // CSS filter string for canvas ctx.filter
    overlay?: {                // Optional color overlay drawn after photos
        color: string;         // rgba color
    };
    thumbnail: string;         // CSS filter for thumbnail preview
}

export const PHOTO_FILTERS: PhotoFilter[] = [
    {
        name: 'none',
        label: 'Original',
        cssFilter: 'none',
        thumbnail: 'none',
    },
    {
        name: 'bw',
        label: 'B&W',
        cssFilter: 'grayscale(1)',
        thumbnail: 'grayscale(1)',
    },
    {
        name: 'vintage',
        label: 'Vintage',
        cssFilter: 'sepia(0.35) contrast(1.1) brightness(0.95)',
        overlay: { color: 'rgba(255, 200, 100, 0.06)' },
        thumbnail: 'sepia(0.35) contrast(1.1) brightness(0.95)',
    },
    {
        name: 'warm',
        label: 'Warm',
        cssFilter: 'saturate(1.3) brightness(1.05)',
        overlay: { color: 'rgba(255, 180, 80, 0.08)' },
        thumbnail: 'saturate(1.3) brightness(1.05)',
    },
    {
        name: 'cool',
        label: 'Cool',
        cssFilter: 'saturate(0.9) brightness(1.05) hue-rotate(10deg)',
        overlay: { color: 'rgba(100, 150, 255, 0.06)' },
        thumbnail: 'saturate(0.9) brightness(1.05) hue-rotate(10deg)',
    },
    {
        name: 'film',
        label: 'Film',
        cssFilter: 'contrast(1.2) brightness(0.95) saturate(0.85)',
        thumbnail: 'contrast(1.2) brightness(0.95) saturate(0.85)',
    },
    {
        name: 'vivid',
        label: 'Vivid',
        cssFilter: 'saturate(1.5) contrast(1.1)',
        thumbnail: 'saturate(1.5) contrast(1.1)',
    },
];

export function getFilterByName(name: string): PhotoFilter {
    return PHOTO_FILTERS.find(f => f.name === name) || PHOTO_FILTERS[0];
}
