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

/**
 * Print quality preset passed to the print backend.
 * - 'draft'  : Fastest speed, lowest ink usage (Epson EPIJ_Qual=308, 180dpi)
 * - 'normal' : Balanced speed & photo quality (Epson EPIJ_Qual=303, 360dpi)
 * - 'fine'   : Crisp photo detail without full slow pass (Epson EPIJ_Qual=304, 360dpi)
 * - 'high'   : Maximum quality / slowest pass (Epson EPIJ_Qual=306, 720dpi)
 */
export type PrintQuality = 'draft' | 'normal' | 'fine' | 'high';

interface PrinterSettingsStore {
    selectedPrinter: string;
    setSelectedPrinter: (printer: string) => void;
    printRotation: PrintRotation;
    setPrintRotation: (rotation: PrintRotation) => void;
    printQuality: PrintQuality;
    setPrintQuality: (quality: PrintQuality) => void;
}

export const usePrinterSettingsStore = create<PrinterSettingsStore>()(
    persist(
        (set) => ({
            selectedPrinter: '',
            setSelectedPrinter: (printer) => set({ selectedPrinter: printer }),
            printRotation: 'auto',
            setPrintRotation: (rotation) => set({ printRotation: rotation }),
            printQuality: 'normal',
            setPrintQuality: (quality) => set({ printQuality: quality }),
        }),
        {
            name: 'chronosnap-printer-settings',
        }
    )
);
