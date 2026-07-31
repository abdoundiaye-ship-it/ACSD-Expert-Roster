-- ================================================================
-- ACSD Expert Roster — Notifications
-- Migration 0018
-- Run in: Supabase Dashboard → SQL Editor
--
-- In-app notifications (a bell icon in the admin shell, always real, no
-- external dependency) plus an optional daily email digest (real, but
-- requires an admin to bring their own Resend API key — see the note near
-- the bottom of this file and the README section for this feature).
--
-- Three real-time sources feed notifications directly at the moment
-- they happen (no polling needed for these):
--   - compute-matches   → a new high-scoring match is found
--   - scan-opportunities → a scan (manual or scheduled) finds new opportunities
-- One scheduled source (send-notification-digest, new Edge Function,
-- deployed alongside this migration) checks once a day for anything with an
-- approaching deadline that nothing else would otherwise announce:
--   - tasks due soon, meetings starting soon, contract milestones due soon,
--     opportunity deadlines approaching
-- and also sends the optional email digest.
-- ================================================================

-- ── 1. Notifications ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type               text        NOT NULL CHECK (type IN (
                        'new_match', 'scan_result', 'task_due_soon',
                        'meeting_upcoming', 'contract_milestone_due', 'opportunity_deadline'
                      )),
  title              text        NOT NULL,
  body               text,
  link_url           text,       -- relative path within docs/admin/, e.g. 'tasks.html'
  -- Lets a scheduled/repeated check (e.g. "still due in 2 days") insert
  -- safely every run via ON CONFLICT DO NOTHING, without re-notifying about
  -- the same underlying thing every single day it stays true.
  dedupe_key         text,
  read               boolean     NOT NULL DEFAULT false,
  notified_via_email boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Per-user, not per-role — the one deliberate break from every other table
-- in this schema's "authenticated read, admin write" convention. A
-- notification is private to the person it's for; even an admin should not
-- be able to browse everyone else's notification feed the way they can
-- browse everyone else's tasks/contracts/etc. Regular users get no INSERT
-- policy at all — notifications are only ever created by Edge Functions
-- running as the service role, which bypasses RLS entirely.
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications_delete_own" ON notifications FOR DELETE USING (auth.uid() = user_id);

-- ── 2. Scheduled digest job ──────────────────────────────────────
-- Same pg_cron + pg_net + Vault pattern as scan-opportunities-daily
-- (migration 0011) — reuses the same service_role_key Vault secret, so if
-- that secret is already stored there is nothing new to configure here.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Runs at 07:00 UTC — one hour after the 06:00 opportunity scan (migration
-- 0011), so a scan_result notification from that same morning's run is
-- already in the table and gets included in today's digest email.
SELECT cron.schedule(
  'notification-digest-daily',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://bazrdeykmntponplkncc.supabase.co/functions/v1/send-notification-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To pause or remove the schedule later:
--   select cron.unschedule('notification-digest-daily');

-- ── 3. Optional email digest ─────────────────────────────────────
-- send-notification-digest sends one summary email per user with unsent
-- notifications, via Resend's HTTP API — but only if a RESEND_API_KEY
-- secret is configured. Without it, the function still runs and still
-- generates the deadline-based in-app notifications above; it just skips
-- the email step and logs that it did. To enable email, sign up for a free
-- Resend account (resend.com — no credit card, generous free tier) and set:
--
--   supabase secrets set RESEND_API_KEY=<your resend api key>
--
-- Sending to recipients other than your own Resend account address also
-- requires verifying a sending domain in Resend's dashboard — a one-time
-- setup step outside what any migration or Edge Function can do for you.
