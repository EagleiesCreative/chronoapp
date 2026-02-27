import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-initialize the admin client to avoid build-time crashes
// This client bypasses Row Level Security (RLS) and should only be used in server-side API routes
let _supabaseAdmin: SupabaseClient | null = null;

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
        if (!_supabaseAdmin) {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
            const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
            _supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                },
            });
        }
        return (_supabaseAdmin as any)[prop];
    },
});
