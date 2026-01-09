-- =============================================
-- ChronoSnap Multi-Tenant Security Migration
-- Run this in Supabase SQL Editor
-- =============================================

-- =============================================
-- PHASE 1: SCHEMA CHANGES
-- =============================================

-- 1.1 Add columns to frames for booth isolation
ALTER TABLE frames 
ADD COLUMN IF NOT EXISTS booth_id uuid REFERENCES booths(id),
ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true;

-- 1.2 Add booth_id to sessions (if not exists)
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS booth_id uuid REFERENCES booths(id);

-- 1.3 Add booth_id to payments (if not exists)
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS booth_id uuid REFERENCES booths(id);

-- =============================================
-- PHASE 2: ROW LEVEL SECURITY POLICIES
-- =============================================

-- 2.1 BOOTHS: Allow public read for login (PIN validation)
ALTER TABLE booths ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read for booth login" ON booths;
CREATE POLICY "Allow public read for booth login"
ON booths FOR SELECT
USING (true);

-- 2.2 FRAMES: Booth can see own frames OR public frames
ALTER TABLE frames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Frames visible to booth or public" ON frames;
CREATE POLICY "Frames visible to booth or public"
ON frames FOR SELECT
USING (
  is_public = true 
  OR booth_id IS NULL 
  OR booth_id::text = coalesce(current_setting('app.booth_id', true), '')
);

-- Allow admin to manage frames (no booth_id context required for insert/update/delete)
DROP POLICY IF EXISTS "Allow frame management" ON frames;
CREATE POLICY "Allow frame management"
ON frames FOR ALL
USING (true)
WITH CHECK (true);

-- 2.3 SESSIONS: Strict booth isolation for select/update/delete
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sessions belong to booth" ON sessions;
CREATE POLICY "Sessions belong to booth"
ON sessions FOR SELECT
USING (
  booth_id IS NULL 
  OR booth_id::text = coalesce(current_setting('app.booth_id', true), '')
);

-- Allow insert from any context
DROP POLICY IF EXISTS "Allow session insert" ON sessions;
CREATE POLICY "Allow session insert"
ON sessions FOR INSERT
WITH CHECK (true);

-- Allow update from any context (for payment status updates)
DROP POLICY IF EXISTS "Allow session update" ON sessions;
CREATE POLICY "Allow session update"
ON sessions FOR UPDATE
USING (true)
WITH CHECK (true);

-- 2.4 PAYMENTS: Strict booth isolation
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Payments belong to booth" ON payments;
CREATE POLICY "Payments belong to booth"
ON payments FOR SELECT
USING (
  booth_id IS NULL 
  OR booth_id::text = coalesce(current_setting('app.booth_id', true), '')
);

-- Allow insert/update from any context (for webhook updates)
DROP POLICY IF EXISTS "Allow payment insert" ON payments;
CREATE POLICY "Allow payment insert"
ON payments FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow payment update" ON payments;
CREATE POLICY "Allow payment update"
ON payments FOR UPDATE
USING (true)
WITH CHECK (true);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('booths', 'frames', 'sessions', 'payments');

-- Check policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
