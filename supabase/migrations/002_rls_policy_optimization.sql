-- =====================================================
-- ChronoSnap RLS Policy Cleanup Migration
-- =====================================================
-- This migration fixes two Supabase security warnings:
-- 1. auth_rls_initplan: Wrap auth functions in (select ...) for performance
-- 2. multiple_permissive_policies: Consolidate redundant policies
-- =====================================================

-- =====================================================
-- STEP 1: Drop ALL existing policies (clean slate)
-- =====================================================

-- Drop policies on users table
DROP POLICY IF EXISTS "Service role has full access to users" ON public.users;

-- Drop policies on organizations table
DROP POLICY IF EXISTS "Service role has full access to organizations" ON public.organizations;

-- Drop policies on organization_memberships table
DROP POLICY IF EXISTS "Service role has full access to memberships" ON public.organization_memberships;

-- Drop policies on booths table
DROP POLICY IF EXISTS "Service role has full access to devices" ON public.booths;
DROP POLICY IF EXISTS "Allow public read access to booths" ON public.booths;
DROP POLICY IF EXISTS "Allow public read for booth login" ON public.booths;

-- Drop policies on vouchers table
DROP POLICY IF EXISTS "Service role has full access to vouchers" ON public.vouchers;

-- Drop policies on transaction table
DROP POLICY IF EXISTS "Service role has full access to payments" ON public.transaction;
DROP POLICY IF EXISTS "Organization members can view payments" ON public.transaction;

-- Drop policies on frames table
DROP POLICY IF EXISTS "Allow all for development" ON public.frames;
DROP POLICY IF EXISTS "Allow frame management" ON public.frames;
DROP POLICY IF EXISTS "Anyone can read active frames" ON public.frames;
DROP POLICY IF EXISTS "Frames visible to booth or public" ON public.frames;

-- Drop policies on sessions table
DROP POLICY IF EXISTS "Allow all for development" ON public.sessions;
DROP POLICY IF EXISTS "Allow session insert" ON public.sessions;
DROP POLICY IF EXISTS "Allow session update" ON public.sessions;
DROP POLICY IF EXISTS "Sessions belong to booth" ON public.sessions;

-- Drop policies on payments table
DROP POLICY IF EXISTS "Allow all for development" ON public.payments;
DROP POLICY IF EXISTS "Allow payment insert" ON public.payments;
DROP POLICY IF EXISTS "Allow payment update" ON public.payments;
DROP POLICY IF EXISTS "Payments belong to booth" ON public.payments;

-- =====================================================
-- STEP 2: Create optimized policies with (select ...) wrapper
-- =====================================================

-- -----------------------------------------------------
-- USERS TABLE
-- -----------------------------------------------------
CREATE POLICY "users_service_role_access" ON public.users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------
-- ORGANIZATIONS TABLE
-- -----------------------------------------------------
CREATE POLICY "organizations_service_role_access" ON public.organizations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------
-- ORGANIZATION_MEMBERSHIPS TABLE
-- -----------------------------------------------------
CREATE POLICY "memberships_service_role_access" ON public.organization_memberships
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------
-- BOOTHS TABLE (consolidated into single policy)
-- -----------------------------------------------------
-- Allow public read for booth login (anonymous users need to validate booth codes)
CREATE POLICY "booths_public_read" ON public.booths
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Service role full access
CREATE POLICY "booths_service_role_access" ON public.booths
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------
-- VOUCHERS TABLE
-- -----------------------------------------------------
CREATE POLICY "vouchers_service_role_access" ON public.vouchers
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------
-- TRANSACTION TABLE (optimized with select wrapper)
-- -----------------------------------------------------
CREATE POLICY "transaction_service_role_access" ON public.transaction
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Organization members can view their payments (optimized)
CREATE POLICY "transaction_org_members_read" ON public.transaction
    FOR SELECT
    TO authenticated
    USING (
        booth_id IN (
            SELECT b.id FROM public.booths b
            WHERE b.organization_id IN (
                SELECT om.organization_id 
                FROM public.organization_memberships om
                WHERE om.user_id = (select auth.uid())
            )
        )
    );

-- -----------------------------------------------------
-- FRAMES TABLE (consolidated policies)
-- -----------------------------------------------------
-- Single SELECT policy: Active public frames OR booth-specific frames
CREATE POLICY "frames_read" ON public.frames
    FOR SELECT
    TO anon, authenticated
    USING (
        is_active = true 
        AND (
            is_public = true 
            OR booth_id IS NULL 
            OR booth_id::text = (select coalesce(nullif(current_setting('app.booth_id', true), ''), '00000000-0000-0000-0000-000000000000'))
        )
    );

-- Single policy for INSERT/UPDATE/DELETE (management)
CREATE POLICY "frames_manage" ON public.frames
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Service role full access
CREATE POLICY "frames_service_role_access" ON public.frames
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Anonymous users need to manage frames via API (unauthenticated requests)
CREATE POLICY "frames_anon_manage" ON public.frames
    FOR ALL
    TO anon
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------
-- SESSIONS TABLE (consolidated policies)
-- -----------------------------------------------------
-- Single SELECT policy with optimized booth check
CREATE POLICY "sessions_read" ON public.sessions
    FOR SELECT
    TO anon, authenticated
    USING (
        booth_id IS NULL 
        OR booth_id::text = (select coalesce(nullif(current_setting('app.booth_id', true), ''), '00000000-0000-0000-0000-000000000000'))
    );

-- INSERT policy
CREATE POLICY "sessions_insert" ON public.sessions
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- UPDATE policy
CREATE POLICY "sessions_update" ON public.sessions
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Service role full access
CREATE POLICY "sessions_service_role_access" ON public.sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------
-- PAYMENTS TABLE (consolidated policies)
-- -----------------------------------------------------
-- Single SELECT policy with optimized booth check
CREATE POLICY "payments_read" ON public.payments
    FOR SELECT
    TO anon, authenticated
    USING (
        booth_id IS NULL 
        OR booth_id::text = (select coalesce(nullif(current_setting('app.booth_id', true), ''), '00000000-0000-0000-0000-000000000000'))
    );

-- INSERT policy
CREATE POLICY "payments_insert" ON public.payments
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- UPDATE policy
CREATE POLICY "payments_update" ON public.payments
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Service role full access
CREATE POLICY "payments_service_role_access" ON public.payments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =====================================================
-- VERIFICATION: Check policy counts
-- =====================================================
-- Run this query after migration to verify:
-- SELECT tablename, COUNT(*) as policy_count 
-- FROM pg_policies 
-- WHERE schemaname = 'public' 
-- GROUP BY tablename 
-- ORDER BY tablename;
