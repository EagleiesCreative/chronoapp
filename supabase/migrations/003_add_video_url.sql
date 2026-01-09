-- Migration: Add video_url column to sessions table
-- This enables storing stop-motion videos generated from captured photos

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN sessions.video_url IS 'URL to the stop-motion video generated from session photos';
