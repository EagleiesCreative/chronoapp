import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LocalSaveStore {
    /** Whether local photo saving is enabled */
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;

    /** Absolute path to the local save directory */
    savePath: string | null;
    setSavePath: (path: string | null) => void;
}

/**
 * Persisted store for local save settings.
 * Stored in localStorage (NOT in Supabase) since the save path is machine-specific.
 */
export const useLocalSaveStore = create<LocalSaveStore>()(
    persist(
        (set) => ({
            enabled: false,
            setEnabled: (enabled) => set({ enabled }),
            savePath: null,
            setSavePath: (path) => set({ savePath: path }),
        }),
        { name: 'chronosnap-local-save' }
    )
);
