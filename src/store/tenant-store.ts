import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Booth } from '@/lib/supabase';

// Tenant store - persisted to localStorage
interface TenantState {
    booth: Booth | null;
    isLoading: boolean;
    error: string | null;

    setBooth: (booth: Booth | null) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    clearTenant: () => void;
}

export const useTenantStore = create<TenantState>()(
    persist(
        (set) => ({
            booth: null,
            isLoading: false,
            error: null,

            setBooth: (booth) => set({ booth, error: null }),
            setLoading: (isLoading) => set({ isLoading }),
            setError: (error) => set({ error }),
            clearTenant: () => set({ booth: null, error: null }),
        }),
        {
            name: 'chronosnap-tenant',
            partialize: (state) => ({ booth: state.booth }),
        }
    )
);

// Helper to get current tenant price
export function useTenantPrice(): number {
    const booth = useTenantStore((state) => state.booth);
    return booth?.price || 0;
}

// Helper to check if tenant is configured
export function useTenantConfigured(): boolean {
    const booth = useTenantStore((state) => state.booth);
    return booth !== null;
}
