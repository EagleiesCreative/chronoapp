import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Manual print rotation applied on top of automatic orientation.
 * 'auto'  = let the print backend orient the image from its aspect ratio.
 * '90' | '180' | '270' = force that clockwise rotation of the image before
 * printing. This is the operator's escape hatch for dye-sub drivers (e.g. the
 * DNP RX1HS) that report their 4x6 media as 6x4 and print sideways.
 */
export type PrintRotation = 'auto' | '90' | '180' | '270';

interface PrinterSettingsStore {
    printRotation: PrintRotation;
    setPrintRotation: (rotation: PrintRotation) => void;
}

export const usePrinterSettingsStore = create<PrinterSettingsStore>()(
    persist(
        (set) => ({
            printRotation: 'auto',
            setPrintRotation: (rotation) => set({ printRotation: rotation }),
        }),
        {
            name: 'chronosnap-printer-settings',
        }
    )
);
