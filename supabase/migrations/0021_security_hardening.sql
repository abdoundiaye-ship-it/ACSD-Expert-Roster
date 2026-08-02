-- ================================================================
-- ACSD Expert Roster — Security Hardening
-- Migration 0021
-- Run in: Supabase Dashboard → SQL Editor
--
-- Fixes from the 2026-08-02 technical review:
--
-- H1/H2: every table added from migration 0006 onward used
-- `FOR SELECT USING (auth.role() = 'authenticated')` — any logged-in
-- "viewer" account could read it directly via the REST API
-- (`/rest/v1/<table>?select=*`) even though the entire `docs/admin/`
-- UI already redirects non-admins away unconditionally (see
-- `initAdmin()` in docs/js/admin.js — role !== 'admin' → redirect).
-- The client-side redirect was never backed by matching RLS. This
-- migration tightens every one of those SELECT policies to
-- `is_admin()`, matching the access the UI already implies.
--
-- Deliberately left untouched: `experts_read`, `permissions_read`,
-- `rp_read` — the expert roster is meant to be browsable by any
-- authenticated user (that's the product), and role/permission
-- metadata is not sensitive business data.
--
-- M1: audit_logs' INSERT policy only checked the caller was
-- authenticated, not that the user_id/user_email they supplied was
-- actually their own — a viewer could forge a log entry framing
-- another user. Fixed with a BEFORE INSERT trigger that overwrites
-- both columns with the authoritative values from auth.uid(), so the
-- client-supplied values are never trusted regardless of what
-- logAudit() sends.
--
-- M2: profiles_self_update let a user change any column on their own
-- row, including is_active — an admin-deactivated user could
-- self-reactivate via a direct REST call. Fixed with a BEFORE UPDATE
-- trigger that pins is_active to its previous value unless the actor
-- is an admin (Postgres RLS can't express column-level restrictions
-- directly in a WITH CHECK clause without an unreliable OLD/NEW
-- comparison, so a trigger is the correct tool here, not a policy).
-- ================================================================

-- ── 1. Lock down business-data tables to admin-only reads (H1 + H2) ──

ALTER POLICY "opportunities_read"           ON opportunities              USING (is_admin());
ALTER POLICY "opp_sectors_read"             ON opportunity_sectors        USING (is_admin());
ALTER POLICY "opp_languages_read"           ON opportunity_languages      USING (is_admin());
ALTER POLICY "opp_geographies_read"         ON opportunity_geographies    USING (is_admin());
ALTER POLICY "opp_activity_types_read"      ON opportunity_activity_types USING (is_admin());
ALTER POLICY "opp_positions_read"           ON opportunity_positions      USING (is_admin());
ALTER POLICY "opp_matches_read"             ON opportunity_expert_matches USING (is_admin());
ALTER POLICY "opp_selected_experts_read"    ON opportunity_selected_experts USING (is_admin());
ALTER POLICY "opp_expense_items_read"       ON opportunity_expense_items  USING (is_admin());
ALTER POLICY "proposal_documents_read"      ON proposal_documents         USING (is_admin());

ALTER POLICY "intelligence_sources_read"    ON intelligence_sources       USING (is_admin());
ALTER POLICY "scan_runs_read"               ON scan_runs                  USING (is_admin());

ALTER POLICY "kb_documents_read"            ON knowledge_base_documents   USING (is_admin());
ALTER POLICY "lessons_learned_read"         ON lessons_learned            USING (is_admin());

ALTER POLICY "contracts_read"               ON contracts                  USING (is_admin());
ALTER POLICY "contract_milestones_read"     ON contract_milestones        USING (is_admin());

ALTER POLICY "tasks_read"                   ON tasks                      USING (is_admin());

ALTER POLICY "meetings_read"                ON meetings                   USING (is_admin());
ALTER POLICY "meeting_attendees_read"       ON meeting_attendees          USING (is_admin());
ALTER POLICY "meeting_action_items_read"    ON meeting_action_items       USING (is_admin());

ALTER POLICY "comments_read"                ON comments                   USING (is_admin());

ALTER POLICY "webhooks_read"                ON webhooks                   USING (is_admin());
ALTER POLICY "webhook_deliveries_read"      ON webhook_deliveries         USING (is_admin());

ALTER POLICY "clients_read"                 ON clients                    USING (is_admin());
ALTER POLICY "client_contacts_read"         ON client_contacts            USING (is_admin());
ALTER POLICY "client_interactions_read"     ON client_interactions        USING (is_admin());

-- ── 2. audit_logs: server-side actor, never client-trusted (M1) ─────

CREATE OR REPLACE FUNCTION audit_logs_set_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.user_id := auth.uid();
  NEW.user_email := COALESCE((SELECT email FROM profiles WHERE id = auth.uid()), NEW.user_email, 'unknown');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_force_actor ON audit_logs;
CREATE TRIGGER audit_logs_force_actor
  BEFORE INSERT ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_set_actor();

-- ── 3. profiles: is_active can only change via an admin action (M2) ─

CREATE OR REPLACE FUNCTION profiles_protect_is_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    NEW.is_active := OLD.is_active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_is_active_trg ON profiles;
CREATE TRIGGER profiles_protect_is_active_trg
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION profiles_protect_is_active();
