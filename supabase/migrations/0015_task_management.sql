-- ================================================================
-- ACSD Expert Roster — Task Management & Calendar Integration
-- Migration 0015
-- Run in: Supabase Dashboard → SQL Editor
--
-- Assignment and deadline tracking, optionally linked to the opportunity
-- or contract the work came from — cross-cutting, since a task can be
-- bid-side ("finish TOR analysis by Friday") or delivery-side ("submit
-- Q1 progress report").
--
-- Calendar Integration is a real, working iCalendar (.ics) subscription
-- feed — every mainstream calendar app (Google, Outlook, Apple) can
-- subscribe to a plain .ics URL with no OAuth app registration needed.
-- A full two-way Google/Outlook OAuth sync would require registering and
-- getting approval for an OAuth app in each vendor's developer console —
-- an external dependency outside what this migration can complete, the
-- same category of constraint that shaped the ReliefWeb decision in
-- Module 1. Each user's feed URL is secured by an unguessable per-user
-- token (profiles.calendar_token) rather than interactive login, because
-- that's how calendar apps actually fetch subscribed URLs — periodic
-- anonymous GET requests, not an OAuth-authenticated session.
-- ================================================================

-- ── 1. Tasks ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  title          text        NOT NULL,
  description    text,
  assigned_to    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  opportunity_id uuid        REFERENCES opportunities(id) ON DELETE SET NULL,
  contract_id    uuid        REFERENCES contracts(id) ON DELETE SET NULL,
  due_date       date,
  priority       text        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  -- "Overdue" is deliberately not a stored status — same reasoning as
  -- contract_milestones: derived in the UI from due_date < today AND
  -- status != 'done', so it can never go stale.
  status         text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  created_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_assigned_idx     ON tasks (assigned_to);
CREATE INDEX IF NOT EXISTS tasks_status_idx       ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx     ON tasks (due_date);
CREATE INDEX IF NOT EXISTS tasks_opportunity_idx  ON tasks (opportunity_id);
CREATE INDEX IF NOT EXISTS tasks_contract_idx     ON tasks (contract_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_read"  ON tasks FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "tasks_admin" ON tasks FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 2. Per-user calendar subscription token ─────────────────────
-- gen_random_uuid() is volatile, so ADD COLUMN ... DEFAULT here assigns
-- a distinct random token to every existing profile row, not one shared
-- value — no separate backfill statement needed.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS calendar_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS profiles_calendar_token_idx ON profiles (calendar_token);
