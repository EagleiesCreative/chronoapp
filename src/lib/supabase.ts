import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Lazy getter for admin client (server-side only)
// This avoids importing supabase-admin at the top level which would break client-side code
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available. This function can only be called server-side.');
    }
    _supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _supabaseAdmin;
}

// Canvas size presets (for printing)
export const CANVAS_SIZES = {
  '2R': { width: 600, height: 1050, label: '2R (2.5" × 3.5")' },  // Default
  '4R': { width: 1200, height: 1800, label: '4R (4" × 6")' },
  'A4': { width: 2480, height: 3508, label: 'A4 (210mm × 297mm)' },  // 300 DPI
} as const;

// Default canvas size (2R)
export const DEFAULT_CANVAS_WIDTH = CANVAS_SIZES['2R'].width;
export const DEFAULT_CANVAS_HEIGHT = CANVAS_SIZES['2R'].height;

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
}

export interface Session {
  id: string;
  payment_id: string | null;
  frame_id: string;
  status: 'pending' | 'paid' | 'capturing' | 'compositing' | 'completed' | 'cancelled';
  photos_urls: string[];
  final_image_url: string | null;
  created_at: string;
  updated_at: string;
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

export async function createSession(frameId: string, boothId?: string): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      frame_id: frameId,
      booth_id: boothId || null,
      status: 'pending',
      photos_urls: [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
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
// Client-side upload functions (use public anon key)
// These bypass Vercel's 4.5MB serverless function body limit
// by uploading directly to Supabase Storage from the browser.
// Requires an INSERT RLS policy on the 'photos' bucket for
// the 'sessions/' path.
// ============================================================

async function uploadWithRetry(
  bucket: string,
  path: string,
  blob: Blob,
  contentType: string,
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, blob, {
          contentType,
          upsert: true,
        });

      if (error) throw error;

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Upload attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);

      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error('Upload failed after retries');
}

/**
 * Upload the final composite strip image (client-side, direct to Supabase)
 */
export async function uploadFinalImageClient(sessionId: string, blob: Blob): Promise<string> {
  const fileName = `sessions/${sessionId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  return uploadWithRetry('photos', fileName, blob, 'image/jpeg');
}

/**
 * Upload an individual photo (client-side, direct to Supabase)
 */
export async function uploadPhotoClient(sessionId: string, photoIndex: number, blob: Blob): Promise<string> {
  const fileName = `sessions/${sessionId}/photo_${photoIndex + 1}_${Date.now()}.jpg`;
  return uploadWithRetry('photos', fileName, blob, 'image/jpeg');
}

/**
 * Upload a GIF (client-side, direct to Supabase)
 */
export async function uploadGifClient(sessionId: string, blob: Blob): Promise<string> {
  const fileName = `sessions/${sessionId}/stopmotion_${Date.now()}.gif`;
  return uploadWithRetry('photos', fileName, blob, 'image/gif');
}

// Upload photo to storage (using admin client to bypass RLS)
export async function uploadPhoto(
  sessionId: string,
  photoIndex: number,
  blob: Blob
): Promise<string> {
  const fileName = `${sessionId}/photo_${photoIndex}_${Date.now()}.jpg`;
  const admin = getSupabaseAdmin();

  const { error } = await admin.storage
    .from('photos')
    .upload(fileName, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw error;

  const { data } = admin.storage.from('photos').getPublicUrl(fileName);
  return data.publicUrl;
}

// Upload final composited image (using admin client to bypass RLS)
export async function uploadFinalImage(sessionId: string, blob: Blob): Promise<string> {
  const fileName = `${sessionId}/final_${Date.now()}.jpg`;
  const admin = getSupabaseAdmin();

  const { error } = await admin.storage
    .from('photos')
    .upload(fileName, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw error;

  const { data } = admin.storage.from('photos').getPublicUrl(fileName);
  return data.publicUrl;
}
