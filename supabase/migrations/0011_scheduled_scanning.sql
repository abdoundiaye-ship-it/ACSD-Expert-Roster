-- ================================================================
-- ACSD Expert Roster — Module 1: Scheduled, Autonomous Scanning
-- Migration 0011
-- Run in: Supabase Dashboard → SQL Editor
--
-- Promotes opportunity scanning from purely admin-triggered to a
-- recurring background job (pg_cron + pg_net), while leaving the
-- on-demand "Scan Sources" button working exactly as before. Every
-- run — manual click or scheduled — is now logged to scan_runs so
-- admins can see what the automated daily scan actually did.
-- ================================================================

-- ── 1. Scan run history ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scan_runs (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  triggered_by          text        NOT NULL CHECK (triggered_by IN ('manual', 'scheduled')),
  triggered_by_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  new_count             integer     NOT NULL DEFAULT 0,
  go_count              integer     NOT NULL DEFAULT 0,
  a_etudier_count       integer     NOT NULL DEFAULT 0,
  veille_count          integer     NOT NULL DEFAULT 0,
  rejet_count           integer     NOT NULL DEFAULT 0,
  results               jsonb,
  error                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_runs_read"  ON scan_runs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "scan_runs_admin" ON scan_runs FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 2. Scheduling infrastructure ────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- The service-role key authenticates the cron job to scan-opportunities
-- as a trusted system caller (see the Edge Function's triggeredBy check —
-- a request bearing this exact key is treated as "scheduled" and skips
-- the per-user admin-role lookup). It is intentionally NOT stored in this
-- migration file or committed to git.
--
-- Before scheduling the job below, run this yourself in the SQL Editor
-- with the real key from Project Settings → API → service_role:
--
--   select vault.create_secret('<your service_role key>', 'service_role_key');
--
-- If the key is ever rotated, update it with:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'service_role_key'),
--     '<new service_role key>'
--   );

SELECT cron.schedule(
  'scan-opportunities-daily',
  '0 6 * * *',  -- 06:00 UTC daily
  $$
  SELECT net.http_post(
    url     := 'https://bazrdeykmntponplkncc.supabase.co/functions/v1/scan-opportunities',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'
      )
    ),
    body := jsonb_build_object('all', true)
  ) AS request_id;
  $$
);

-- To pause or remove the schedule later:
--   select cron.unschedule('scan-opportunities-daily');
