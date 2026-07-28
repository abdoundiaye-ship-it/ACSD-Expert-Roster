-- ================================================================
-- ACSD Expert Roster — Meeting Management / AI Secretary
-- Migration 0016
-- Run in: Supabase Dashboard → SQL Editor
--
-- Scheduling and structured minutes for meetings, optionally linked to the
-- opportunity or contract they relate to — the same cross-cutting pattern
-- as tasks (a meeting can be bid-side, e.g. a donor clarification call, or
-- delivery-side, e.g. a client progress review).
--
-- "AI Secretary" here means: an admin pastes their own raw notes or a rough
-- transcript taken during/after the meeting, and analyze-meeting-notes
-- structures it into a summary, decisions, and action items — the same
-- "paste → AI extracts" pattern already used for opportunity intake and
-- knowledge-base documents. There is no live audio capture or transcription
-- (that needs a bot joining the call or a speech-to-text pipeline — a real
-- external dependency this migration can't complete) and no auto-sent
-- calendar invites to attendees.
-- ================================================================

-- ── 1. Meetings ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meetings (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  title          text        NOT NULL,
  description    text,
  opportunity_id uuid        REFERENCES opportunities(id) ON DELETE SET NULL,
  contract_id    uuid        REFERENCES contracts(id) ON DELETE SET NULL,
  start_time     timestamptz NOT NULL,
  end_time       timestamptz,
  location       text,       -- physical address or a virtual-meeting link/description
  status         text        NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  external_attendees text,   -- free text for donor/client attendees not in `profiles`, e.g. "Jane Doe (World Bank)"
  raw_notes      text,       -- pasted notes/transcript — the AI Secretary's input
  ai_summary     text,       -- AI-generated summary of raw_notes
  ai_decisions   jsonb,      -- AI-extracted array of decision strings
  created_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetings_start_time_idx  ON meetings (start_time);
CREATE INDEX IF NOT EXISTS meetings_opportunity_idx ON meetings (opportunity_id);
CREATE INDEX IF NOT EXISTS meetings_contract_idx    ON meetings (contract_id);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meetings_read"  ON meetings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "meetings_admin" ON meetings FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 2. Internal attendees ────────────────────────────────────────
-- A junction table (not a jsonb array) so each attendee's meetings also
-- surface on their own personal calendar feed — calendar-feed is extended
-- alongside this migration to include meetings the caller's profile is
-- attending, not just their assigned tasks.

CREATE TABLE IF NOT EXISTS meeting_attendees (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (meeting_id, profile_id)
);

CREATE INDEX IF NOT EXISTS meeting_attendees_meeting_idx ON meeting_attendees (meeting_id);
CREATE INDEX IF NOT EXISTS meeting_attendees_profile_idx ON meeting_attendees (profile_id);

ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meeting_attendees_read"  ON meeting_attendees FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "meeting_attendees_admin" ON meeting_attendees FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 3. Action items ──────────────────────────────────────────────
-- AI-suggested (from raw_notes) or added by hand; each can be converted
-- into a real row in `tasks` via task_id, at which point it's tracked like
-- any other task (assignee, due date, status) instead of living as a
-- second, parallel to-do system.

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id         uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  description        text NOT NULL,
  suggested_assignee text,  -- AI's best-effort guess from the notes text, free text — not a profiles FK, since the AI can't reliably resolve a name to an account
  task_id            uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_action_items_meeting_idx ON meeting_action_items (meeting_id);

ALTER TABLE meeting_action_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meeting_action_items_read"  ON meeting_action_items FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "meeting_action_items_admin" ON meeting_action_items FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
