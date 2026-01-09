-- Migration: Add device_token for single-device login enforcement
-- Each booth code can only be logged in on ONE device at a time

ALTER TABLE booths
ADD COLUMN IF NOT EXISTS device_token TEXT,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN booths.device_token IS 'Unique token for the currently logged-in device. Used to enforce single-device login.';
COMMENT ON COLUMN booths.last_login_at IS 'Timestamp of the last login for this booth.';
