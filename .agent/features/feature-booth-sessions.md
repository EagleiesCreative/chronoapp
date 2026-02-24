# Booth Sessions (Admin-Level Session Profiles)

## Problem
Currently, all booth settings (price, active frames, countdown duration, filters, branding, etc.) are stored globally on the `Booth` record. When an operator runs the same booth at different events or contexts (e.g., a wedding on Saturday, a corporate event on Monday), they must manually reconfigure every setting each time. There is also no way to group or filter photos by which "configuration session" they belong to — all photos are lumped together under the booth.

## Goal
Introduce **Booth Sessions** — a named, reusable configuration profile that groups:
1. **All booth settings** (price, active frames, countdown, filters, branding, event mode, etc.)
2. **All captured photos** (every photo session/transaction is tagged with the active booth session)

The admin can **create, switch, duplicate, and delete** booth sessions from the Admin Panel. Only one booth session is "active" at a time per booth. When the active session changes, the booth automatically loads that session's settings and frames.

## Terminology
| Term | Meaning |
|------|---------|
| **Booth Session** | A named configuration profile for a booth (admin-level, long-lived) |
| **Photo Session** | A single customer transaction (existing `sessions` table — one per customer use) |

> ⚠️ Do NOT confuse these. The existing `sessions` table represents individual customer photo transactions. The new `booth_sessions` table represents operator-level configuration profiles.

## Design (Senior UX Perspective)

### Data Model

#### New Table: `booth_sessions`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | uuid | gen_random_uuid() | Primary key |
| `booth_id` | uuid | NOT NULL | FK → `booths.id` |
| `name` | text | NOT NULL | Display name (e.g., "Sarah & Tom Wedding", "Corporate Event Dec") |
| `is_active` | boolean | false | Only one active per booth |
| `price` | integer | 15000 | Price override for this session (in IDR) |
| `countdown_seconds` | integer | 3 | Countdown before capture |
| `preview_seconds` | integer | 3 | Preview duration after each shot |
| `review_timeout_seconds` | integer | 60 | Auto-reset timeout on review screen |
| `print_copies` | integer | 1 | Number of print copies |
| `default_filter` | text | 'none' | Default photo filter |
| `payment_bypass` | boolean | false | Skip payment for free events |
| `event_mode` | boolean | false | Enable event branding |
| `event_name` | text | null | Event display name |
| `event_date` | text | null | ISO date |
| `event_hashtag` | text | null | Hashtag overlay |
| `event_splash_image` | text | null | Custom splash image URL |
| `event_message` | text | null | Thank-you message |
| `background_image` | text | null | Idle screen background |
| `background_color` | text | null | Idle screen color |
| `brand_logo_url` | text | null | Custom logo |
| `brand_title` | text | null | Custom title |
| `brand_subtitle` | text | null | Custom subtitle |
| `brand_primary_color` | text | null | Primary color hex |
| `brand_accent_color` | text | null | Accent color hex |
| `slideshow_enabled` | boolean | false | Enable attract loop |
| `created_at` | timestamptz | now() | Record creation time |
| `updated_at` | timestamptz | now() | Last update time |

#### New Join Table: `booth_session_frames`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `booth_session_id` | uuid | FK → `booth_sessions.id` |
| `frame_id` | uuid | FK → `frames.id` |
| `is_active` | boolean | Whether this frame is usable in this session |
| `sort_order` | integer | Display order in frame selector |
| `created_at` | timestamptz | Record creation time |

This allows each booth session to have its own set of active frames, independent of other sessions.

#### Modify Existing Table: `sessions` (photo sessions)

Add column:
| Column | Type | Description |
|--------|------|-------------|
| `booth_session_id` | uuid | FK → `booth_sessions.id` — links each customer photo transaction to the active booth session |

This enables filtering all photos by booth session.

### Admin Panel UI

#### Session Manager (New Tab in Admin Panel)

Add a new tab **"Sessions"** to the admin panel alongside the existing "Frames" tab.

**Session List View:**
- Shows all booth sessions as cards with:
  - Session name
  - Active badge (green dot) for the currently active session
  - Photo count (number of completed photo sessions)
  - Created date
  - Quick actions: Activate, Edit, Duplicate, Delete
- "+ New Session" button at top right
- Active session is highlighted and pinned to top

**Create/Edit Session Dialog:**
- Name field (required)
- Price field
- Timing settings (countdown, preview, review timeout)
- Payment bypass toggle
- Filter default dropdown
- Print copies
- Event mode section (collapsible): event name, date, hashtag, splash image, message
- Branding section (collapsible): logo, title, subtitle, colors, background
- Slideshow toggle
- Frame assignment: multi-select list of all available frames with drag-to-reorder

**Session Switching:**
- Tapping "Activate" on a session:
  1. Sets `is_active = false` on the currently active session
  2. Sets `is_active = true` on the selected session
  3. Reloads booth configuration from the new active session
  4. Shows toast: "Switched to [Session Name]"

**Duplicate Session:**
- Creates a copy of all settings + frame assignments with name "[Original] (Copy)"
- The duplicate starts as inactive

### Booth Flow Integration

When the booth loads or the active session changes:
1. Fetch the active `booth_session` for the current booth
2. Load settings from the booth session (price, countdown, filters, etc.) instead of from the `booths` table
3. Load frames from `booth_session_frames` instead of the global active frames
4. Every new photo session (`sessions` table insert) includes the `booth_session_id`

### Gallery / Photo Filtering (Backoffice)

In the backoffice gallery and reports:
- Add a **Booth Session** filter dropdown
- Filter photos by `sessions.booth_session_id`
- Show booth session name in photo detail views

## Implementation

### Database Migration
- Create `booth_sessions` table with all settings columns
- Create `booth_session_frames` join table
- Add `booth_session_id` column to `sessions` table
- Add unique partial index on `booth_sessions(booth_id) WHERE is_active = true` to enforce single active session
- Create a trigger or use application logic to ensure only one active session per booth

### Files to Create
- `src/components/admin/SessionManager.tsx` — Session list + CRUD UI
- `src/components/admin/SessionEditor.tsx` — Create/Edit session dialog with all settings
- `src/app/api/booth-sessions/route.ts` — CRUD API for booth sessions (GET list, POST create)
- `src/app/api/booth-sessions/[id]/route.ts` — Single session (GET, PATCH update, DELETE)
- `src/app/api/booth-sessions/[id]/activate/route.ts` — Activate a session (PUT)
- `src/app/api/booth-sessions/[id]/duplicate/route.ts` — Duplicate a session (POST)
- `src/app/api/booth-sessions/[id]/frames/route.ts` — Manage frame assignments (GET, PUT)
- `src/store/session-profile-store.ts` — Zustand store for the active booth session config (persisted)

### Files to Modify
- `src/lib/supabase.ts` — Add `BoothSession`, `BoothSessionFrame` interfaces; add `booth_session_id` to `Session` interface; add helper functions `getActiveBoothSession()`, `getBoothSessionFrames()`
- `src/store/booth-store.ts` — Load settings from active booth session instead of booth record; add `activeBoothSession` state
- `src/store/tenant-store.ts` — Store the active booth session alongside the booth
- `src/app/page.tsx` — On booth init, fetch and apply active booth session settings
- `src/components/booth/FrameSelector.tsx` — Fetch frames from `booth_session_frames` for the active session
- `src/components/booth/IdleScreen.tsx` — Read background/branding from active booth session
- `src/hooks/useCaptureFlow.ts` — Read countdown/preview settings from active session
- `src/hooks/useUploadSession.ts` — Include `booth_session_id` when creating photo sessions
- `src/components/admin/index.ts` — Export the new SessionManager component
- `src/components/admin/BackgroundSettings.tsx` — Move settings into session context or keep as fallback

### Migration Strategy
1. Create the new tables
2. For each existing booth, auto-create a **"Default"** booth session that copies current booth settings
3. Set `is_active = true` on the default session
4. Backfill existing `sessions` rows with the default booth session ID
5. Gradually deprecate settings fields on the `booths` table (keep as fallback during transition)

### API Design

#### `GET /api/booth-sessions?boothId=xxx`
Returns all booth sessions for a booth, ordered by active first then by name.

#### `POST /api/booth-sessions`
Body: `{ boothId, name, ...settings, frameIds: string[] }`
Creates a new booth session with frame assignments.

#### `PATCH /api/booth-sessions/[id]`
Body: `{ name?, price?, ...settings }`
Updates session settings.

#### `PUT /api/booth-sessions/[id]/activate`
Sets this session as active, deactivates the previous one. Returns updated booth session.

#### `POST /api/booth-sessions/[id]/duplicate`
Duplicates session with all settings and frame assignments.

#### `DELETE /api/booth-sessions/[id]`
Deletes a session. Cannot delete the active session.

#### `GET /api/booth-sessions/[id]/frames`
Returns frames assigned to this session.

#### `PUT /api/booth-sessions/[id]/frames`
Body: `{ frames: [{ frameId, isActive, sortOrder }] }`
Replaces frame assignments for this session.

## Key Constraints
1. **Only one active session per booth** — enforced at DB level with a partial unique index
2. **Cannot delete the active session** — must activate another one first
3. **Backward compatible** — if no booth session exists (legacy booths), fall back to booth-level settings
4. **All new photo sessions MUST include `booth_session_id`** — this is how photos are grouped
5. **Settings priority**: Booth Session settings > Booth defaults (graceful fallback)
