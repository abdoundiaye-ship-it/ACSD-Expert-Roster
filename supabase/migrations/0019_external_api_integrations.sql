-- ================================================================
-- ACSD Expert Roster — External API Integrations
-- Migration 0019
-- Run in: Supabase Dashboard → SQL Editor
--
-- "External API Integrations" in the original roadmap has no single named
-- target system (unlike Module 1's donor-portal adapters, which are each a
-- specific, real API this codebase pilot-tested). The honest, generic,
-- buildable version of "connections to outside systems... fits into a
-- client's existing technology stack" is outbound webhooks: ACSD configures
-- a URL from whatever tool they already use — Slack (incoming webhook),
-- Zapier, Make.com, n8n, or their own internal system — and this platform
-- POSTs a signed JSON payload to it when something real happens. No
-- specific third-party credential is required to build this; each admin
-- supplies their own destination URL for whatever they want to connect.
--
-- Implemented as database-level triggers (not Edge Function code), because
-- most writes in this schema happen directly from the browser via the
-- Supabase client (RLS-protected), not funneled through a custom Edge
-- Function — a trigger fires regardless of which of those paths wrote the
-- row, so no dispatch logic has to be duplicated across every admin page
-- that can create/update these records. Delivery itself reuses pg_net
-- (already enabled by migration 0011) the same fire-and-forget way the
-- scheduled cron jobs already call their own Edge Functions.
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 1. Webhook registry ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhooks (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        NOT NULL,
  url         text        NOT NULL,
  -- Auto-generated, real signing secret (not a placeholder) — used to HMAC
  -- sign every delivery so the receiving system can verify a payload
  -- actually came from this platform and wasn't forged/replayed by a third
  -- party who guessed the URL.
  secret      text        NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  event_types text[]      NOT NULL DEFAULT '{}',
  active      boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhooks_read"  ON webhooks FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "webhooks_admin" ON webhooks FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 2. Delivery log ───────────────────────────────────────────────
-- pg_net's http_post is fire-and-forget (it returns a request id
-- immediately; the actual response lands later in net._http_response,
-- polling it back out is more machinery than this feature needs) — the
-- same async, unconfirmed delivery model migrations 0011/0018 already use
-- for their own cron-triggered calls. This logs that a delivery was
-- attempted, with what payload, not a confirmed delivery receipt.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  webhook_id uuid        NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type text        NOT NULL,
  payload    jsonb       NOT NULL,
  request_id bigint,      -- pg_net's net.http_post request id, for cross-referencing net._http_response manually if ever needed
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_idx ON webhook_deliveries (webhook_id, created_at DESC);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhook_deliveries_read"  ON webhook_deliveries FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "webhook_deliveries_admin" ON webhook_deliveries FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 3. Dispatch function ─────────────────────────────────────────
-- security definer (same convention as is_admin() in migration 0001) so it
-- can read webhooks/write webhook_deliveries regardless of which role's
-- statement fired the trigger that called it, and REVOKEd from PUBLIC so it
-- is not directly callable via RPC by an ordinary authenticated session —
-- only the SECURITY DEFINER trigger functions below call it.

CREATE OR REPLACE FUNCTION notify_webhook(p_event_type text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  w   record;
  sig text;
  req_id bigint;
BEGIN
  FOR w IN SELECT id, url, secret FROM webhooks WHERE active AND p_event_type = ANY(event_types)
  LOOP
    sig := encode(hmac(p_payload::text, w.secret, 'sha256'), 'hex');
    SELECT net.http_post(
      url     := w.url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Webhook-Event', p_event_type,
        'X-Webhook-Signature', sig
      ),
      body := p_payload
    ) INTO req_id;

    INSERT INTO webhook_deliveries (webhook_id, event_type, payload, request_id)
    VALUES (w.id, p_event_type, p_payload, req_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION notify_webhook(text, jsonb) FROM PUBLIC;

-- ── 4. Event triggers ────────────────────────────────────────────
-- A deliberately small, real set of events — not "every column change on
-- every table," which would be noisy and mostly useless to a receiving
-- system. Each is something a client would plausibly want to react to
-- (ping Slack, create a CRM record, log to an internal system).

CREATE OR REPLACE FUNCTION trg_opportunity_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM notify_webhook('opportunity.created', jsonb_build_object(
    'event', 'opportunity.created', 'id', NEW.id, 'title', NEW.title,
    'organization', NEW.organization, 'opportunity_type', NEW.opportunity_type,
    'status', NEW.status, 'deadline', NEW.deadline, 'created_at', NEW.created_at
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_created_webhook ON opportunities;
CREATE TRIGGER opportunity_created_webhook
  AFTER INSERT ON opportunities
  FOR EACH ROW EXECUTE FUNCTION trg_opportunity_created();

CREATE OR REPLACE FUNCTION trg_opportunity_status_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM notify_webhook('opportunity.status_changed', jsonb_build_object(
    'event', 'opportunity.status_changed', 'id', NEW.id, 'title', NEW.title,
    'old_status', OLD.status, 'new_status', NEW.status
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_status_webhook ON opportunities;
CREATE TRIGGER opportunity_status_webhook
  AFTER UPDATE ON opportunities
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_opportunity_status_changed();

CREATE OR REPLACE FUNCTION trg_task_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM notify_webhook('task.completed', jsonb_build_object(
    'event', 'task.completed', 'id', NEW.id, 'title', NEW.title,
    'opportunity_id', NEW.opportunity_id, 'contract_id', NEW.contract_id
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_completed_webhook ON tasks;
CREATE TRIGGER task_completed_webhook
  AFTER UPDATE ON tasks
  FOR EACH ROW WHEN (NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done')
  EXECUTE FUNCTION trg_task_completed();

CREATE OR REPLACE FUNCTION trg_contract_status_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM notify_webhook('contract.status_changed', jsonb_build_object(
    'event', 'contract.status_changed', 'id', NEW.id, 'title', NEW.title,
    'old_status', OLD.status, 'new_status', NEW.status
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_status_webhook ON contracts;
CREATE TRIGGER contract_status_webhook
  AFTER UPDATE ON contracts
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_contract_status_changed();

-- Known event_types today: opportunity.created, opportunity.status_changed,
-- task.completed, contract.status_changed. Adding a new one later means a
-- new trigger function + trigger here, following the same shape as above —
-- the webhooks.event_types column itself has no CHECK constraint tying it
-- to this list, since it's just a filter value compared against whatever
-- string a trigger happens to emit, not a foreign key.
