-- Migration: Reliability telemetry + offline contact sync support

ALTER TABLE booths
ADD COLUMN IF NOT EXISTS booth_status TEXT,
ADD COLUMN IF NOT EXISTS camera_battery INTEGER,
ADD COLUMN IF NOT EXISTS printer_status TEXT,
ADD COLUMN IF NOT EXISTS prints_remaining INTEGER,
ADD COLUMN IF NOT EXISTS telemetry_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN booths.booth_status IS 'Latest booth runtime status reported by heartbeat (e.g. online/offline)';
COMMENT ON COLUMN booths.camera_battery IS 'Camera battery percentage as reported by booth telemetry';
COMMENT ON COLUMN booths.printer_status IS 'Printer status from booth telemetry (e.g. ready, warning, error)';
COMMENT ON COLUMN booths.prints_remaining IS 'Estimated remaining prints from booth telemetry';
COMMENT ON COLUMN booths.telemetry_updated_at IS 'Timestamp when telemetry fields were last updated';

CREATE TABLE IF NOT EXISTS session_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    booth_id UUID NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
    email TEXT,
    phone TEXT,
    source TEXT NOT NULL DEFAULT 'booth',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_contacts_booth_id ON session_contacts(booth_id);
CREATE INDEX IF NOT EXISTS idx_session_contacts_created_at ON session_contacts(created_at DESC);
