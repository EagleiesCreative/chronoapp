-- Migration: Add device tracking columns for admin dashboard
-- Tracks device name, IP, and heartbeat for online/offline status

ALTER TABLE booths
ADD COLUMN IF NOT EXISTS device_name TEXT,
ADD COLUMN IF NOT EXISTS device_ip TEXT,
ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON COLUMN booths.device_name IS 'Name/identifier of the connected device (from user agent or custom)';
COMMENT ON COLUMN booths.device_ip IS 'IP address of the connected device';
COMMENT ON COLUMN booths.last_heartbeat IS 'Last heartbeat timestamp - used to determine online/offline status';
