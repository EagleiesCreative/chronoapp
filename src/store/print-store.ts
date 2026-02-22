import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PrintJob {
    id: string;
    timestamp: string;
    imageUrl: string;
    copies: number;
    status: 'success' | 'failed';
    session_id?: string;
    error?: string;
}

interface PrintStore {
    history: PrintJob[];
    addJob: (job: Omit<PrintJob, 'id' | 'timestamp'>) => void;
    clearHistory: () => void;
}

export const usePrintStore = create<PrintStore>()(
    persist(
        (set) => ({
            history: [],
            addJob: (job) => set((state) => ({
                // Add to beginning of array, keep max 100 items
                history: [
                    {
                        ...job,
                        id: crypto.randomUUID(),
                        timestamp: new Date().toISOString()
                    },
                    ...state.history
                ].slice(0, 100)
            })),
            clearHistory: () => set({ history: [] })
        }),
        {
            name: 'chronosnap-print-history',
        }
    )
);
