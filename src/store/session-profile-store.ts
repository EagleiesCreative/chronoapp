import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BoothSession } from '@/lib/supabase';

/**
 * Persisted store for the active booth session profile.
 * When the booth boots or switches sessions, this store is updated
 * and all components read settings from here.
 */
interface SessionProfileState {
    activeSession: BoothSession | null;
    setActiveSession: (session: BoothSession | null) => void;
    clearSession: () => void;
}

export const useSessionProfileStore = create<SessionProfileState>()(
    persist(
        (set) => ({
            activeSession: null,
            setActiveSession: (session) => set({ activeSession: session }),
            clearSession: () => set({ activeSession: null }),
        }),
        {
            name: 'chronosnap-session-profile',
            partialize: (state) => ({ activeSession: state.activeSession }),
        }
    )
);

// Helper hooks
export function useActiveSessionSetting<K extends keyof BoothSession>(key: K): BoothSession[K] | undefined {
    return useSessionProfileStore((state) => state.activeSession?.[key]);
}
