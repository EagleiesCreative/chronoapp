import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-initialize the Supabase client to avoid crashing during
// Next.js static export build when env vars are not yet available.
let _supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!_supabaseClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    _supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _supabaseClient;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseClient() as any)[prop];
  },
});

// Lazy getter for admin client (server-side only)
// This avoids importing supabase-admin at the top level which would break client-side code
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available. This function can only be called server-side.');
    }
    _supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _supabaseAdmin;
}

// Canvas size presets (for printing)
// Booth type → canvas dimensions (source of truth: dashboard)
export const BOOTH_TYPE_CANVAS = {
  'REGULAR_4R': { width: 1200, height: 1800, label: '4R (4" × 6")' },
  'A3_NEWSPAPER': { width: 2480, height: 3508, label: 'A3 (297mm × 420mm)' },
} as const;

// Frame canvas sizes available per booth type
export const FRAME_CANVAS_SIZES = {
  'REGULAR_4R': {
    '2R': { width: 600, height: 1050, label: '2R (2.5" × 3.5")' },
    '4R': { width: 1200, height: 1800, label: '4R (4" × 6")' },
  },
  'A3_NEWSPAPER': {
    'A3': { width: 2480, height: 3508, label: 'A3 (297mm × 420mm)' },
  },
} as const;

export type BoothType = keyof typeof BOOTH_TYPE_CANVAS;

// Default canvas size (4R — most common booth type)
export const DEFAULT_CANVAS_WIDTH = BOOTH_TYPE_CANVAS['REGULAR_4R'].width;
export const DEFAULT_CANVAS_HEIGHT = BOOTH_TYPE_CANVAS['REGULAR_4R'].height;

// Database types
export interface Frame {
  id: string;
  name: string;
  image_url: string;
  photo_slots: PhotoSlot[];
  price: number;
  is_active: boolean;
  canvas_width?: number;  // Width in pixels (default: 1500 for 2R)
  canvas_height?: number; // Height in pixels (default: 2102 for 2R)
  created_at: string;
  updated_at: string;
}

export interface PhotoSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  layer?: 'below' | 'above'; // Whether photo renders below or above the frame
  capture_index?: number; // Which camera capture to use (0-indexed). Multiple slots can share the same index.
}

export interface Session {
  id: string;
  payment_id: string | null;
  frame_id: string;
  booth_session_id: string | null;
  status: 'pending' | 'paid' | 'capturing' | 'compositing' | 'completed' | 'cancelled';
  photos_urls: string[];
  final_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoothSession {
  id: string;
  booth_id: string;
  name: string;
  is_active: boolean;
  price: number;
  countdown_seconds: number;
  preview_seconds: number;
  review_timeout_seconds: number;
  print_copies: number;
  default_filter: string;
  filter_enabled: boolean;
  gif_enabled: boolean;
  print_enabled: boolean;
  booth_type: 'REGULAR_4R' | 'A3_NEWSPAPER';
  payment_bypass: boolean;
  event_mode: boolean;
  event_name: string | null;
  event_date: string | null;
  event_hashtag: string | null;
  event_splash_image: string | null;
  event_message: string | null;
  background_image: string | null;
  background_color: string | null;
  brand_logo_url: string | null;
  brand_title: string | null;
  brand_subtitle: string | null;
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  slideshow_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface BoothSessionFrame {
  id: string;
  booth_session_id: string;
  frame_id: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Payment {
  id: string;
  session_id: string;
  xendit_invoice_id: string;
  xendit_qr_string: string | null;
  amount: number;
  status: 'pending' | 'paid' | 'expired' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface Settings {
  id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

// Booth (Tenant) for multi-tenancy
export interface Booth {
  id: string;
  organization_id: string;
  name: string;
  location: string;
  booth_id: string;
  booth_code: string; // PIN for kiosk login
  price: number;
  status: 'active' | 'inactive';
  background_image?: string; // URL to background image for idle screen
  background_color?: string; // Hex color for idle screen background
  payment_bypass?: boolean; // Skip payment logic

  // Feature config fields (new)
  countdown_seconds?: number;
  preview_seconds?: number;
  review_timeout_seconds?: number;
  print_copies?: number;
  slideshow_enabled?: boolean;

  // Custom branding
  brand_logo_url?: string;
  brand_title?: string;
  brand_subtitle?: string;
  brand_primary_color?: string;
  brand_accent_color?: string;

  // Event mode
  event_mode?: boolean;
  event_name?: string;
  event_date?: string;
  event_hashtag?: string;
  event_splash_image?: string;
  event_message?: string;

  // Operational telemetry
  booth_status?: string;
  camera_battery?: number | null;
  printer_status?: string;
  prints_remaining?: number | null;
  telemetry_updated_at?: string;

  // Feature toggles
  gif_enabled?: boolean;
  print_enabled?: boolean;
  filter_enabled?: boolean;
  booth_type?: 'REGULAR_4R' | 'A3_NEWSPAPER';

  created_at: string;
  updated_at: string;
}

// Get booth by PIN code (for tenant login)
export async function getBoothByCode(code: string): Promise<Booth | null> {
  const { data, error } = await supabase
    .from('booths')
    .select('*')
    .eq('booth_code', code)
    .maybeSingle();

  if (error) {
    return null;
  }

  // Check if booth is active
  if (data && data.status !== 'active') {
    return null;
  }

  return data;
}

// Get booth by ID (using admin client to bypass RLS and ensure latest data)
export async function getBoothById(id: string): Promise<Booth | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('booths')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

// Helper functions
export async function getActiveFrames(): Promise<Frame[]> {
  const { data, error } = await supabase
    .from('frames')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getFrameById(id: string): Promise<Frame | null> {
  const { data, error } = await supabase
    .from('frames')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function createSession(frameId: string, boothId?: string, boothSessionId?: string): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      frame_id: frameId,
      booth_id: boothId || null,
      booth_session_id: boothSessionId || null,
      status: 'pending',
      photos_urls: [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get the active booth session for a booth
export async function getActiveBoothSession(boothId: string): Promise<BoothSession | null> {
  const { data, error } = await supabase
    .from('booth_sessions')
    .select('*')
    .eq('booth_id', boothId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return null;
  return data;
}

// Get frames assigned to a booth session
export async function getBoothSessionFrames(boothSessionId: string): Promise<Frame[]> {
  const { data, error } = await supabase
    .from('booth_session_frames')
    .select('frame_id, is_active, sort_order, frames(*)')
    .eq('booth_session_id', boothSessionId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) return [];
  // Extract the nested frame objects
  return (data || []).map((row: any) => row.frames).filter(Boolean);
}

export async function updateSession(id: string, updates: Partial<Session>): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createPayment(
  sessionId: string,
  xenditInvoiceId: string,
  xenditQrString: string | null,
  amount: number,
  boothId?: string
): Promise<Payment> {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      session_id: sessionId,
      booth_id: boothId || null,
      xendit_invoice_id: xenditInvoiceId,
      xendit_qr_string: xenditQrString,
      amount,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePaymentStatus(
  xenditInvoiceId: string,
  status: Payment['status']
): Promise<Payment | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('payments')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('xendit_invoice_id', xenditInvoiceId)
    .select()
    .single();

  if (error) return null;
  return data;
}

export async function getPaymentBySessionId(sessionId: string): Promise<Payment | null> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

export async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();

  if (error) return null;
  return data?.value || null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) throw error;
}

// Subscribe to payment updates in real-time
export function subscribeToPaymentUpdates(
  sessionId: string,
  callback: (payment: Payment) => void
) {
  return supabase
    .channel(`payments:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'payments',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        callback(payload.new as Payment);
      }
    )
    .subscribe();
}

// ============================================================
// Upload logic migrated to Cloudflare R2
// ============================================================

import { uploadPhotoClient, uploadFinalImageClient, uploadGifClient, uploadVideoClient } from './upload-client';

export { uploadPhotoClient, uploadFinalImageClient, uploadGifClient, uploadVideoClient };

/**
 * Server-side upload to R2 (replaces previous Supabase Storage logic)
 */
export async function uploadPhoto(
  sessionId: string,
  photoIndex: number,
  blob: Blob
): Promise<string> {
  const { uploadBufferToR2 } = await import('./r2');
  const buffer = Buffer.from(await blob.arrayBuffer());
  const fileName = `sessions/${sessionId}/photo_${photoIndex}_${Date.now()}.jpg`;
  return uploadBufferToR2(fileName, buffer, 'image/jpeg');
}

/**
 * Server-side upload to R2 (replaces previous Supabase Storage logic)
 */
export async function uploadFinalImage(sessionId: string, blob: Blob): Promise<string> {
  const { uploadBufferToR2 } = await import('./r2');
  const buffer = Buffer.from(await blob.arrayBuffer());
  const fileName = `sessions/${sessionId}/final_${Date.now()}.jpg`;
  return uploadBufferToR2(fileName, buffer, 'image/jpeg');
}
