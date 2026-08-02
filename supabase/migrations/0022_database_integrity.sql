-- ================================================================
-- ACSD Expert Roster — Database Integrity
-- Migration 0022
-- Run in: Supabase Dashboard → SQL Editor
--
-- Fixes from the 2026-08-02 technical review (Batch 2 — database).
--
-- H3 + M9: every "created_by"/"added_by" style FK to auth.users(id)
-- across migrations 0006-0020 defaulted to ON DELETE RESTRICT except two
-- (audit_logs.user_id, tasks.assigned_to), which already correctly used
-- SET NULL — offboarding a staff member fails unpredictably the moment
-- they've ever created an opportunity, contract, task, meeting, webhook,
-- client, KB document, lesson, or proposal document. This migration makes
-- every actor-tracking FK to auth.users(id) consistently SET NULL: the
-- business record survives, it just loses its "created by" attribution
-- once that account is gone — the same tradeoff already made for
-- audit_logs and tasks.
--
-- opportunity_selected_experts.expert_id and opportunity_expert_matches
-- had inconsistent behavior for the same underlying relationship (delete
-- an expert who was ever shortlisted → RESTRICT blocked the delete
-- entirely with a raw FK-violation toast). opportunity_expert_matches
-- already correctly CASCADEs; opportunity_selected_experts.expert_id is
-- NOT NULL so SET NULL isn't an option there — CASCADE is the correct
-- fix (removes the now-meaningless team-assignment row along with the
-- expert, same as the match-score rows already do).
-- proposal_documents.expert_id is nullable and SET NULL there preserves
-- the generated document while dropping the dangling reference —
-- matching the choice opportunity_expense_items.expert_id already made.
--
-- Constraint names are looked up via pg_constraint rather than assumed,
-- following the same defensive pattern migration 0020 already used for
-- comments' entity_type CHECK, since these were all originally created
-- as unnamed inline REFERENCES and Postgres's default naming isn't worth
-- hardcoding a guess at.
-- ================================================================

DO $$
DECLARE
  spec  record;
  fkcon record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('opportunities',               'created_by', 'auth.users', 'id', 'SET NULL'),
      ('opportunity_selected_experts', 'added_by',   'auth.users', 'id', 'SET NULL'),
      ('opportunity_selected_experts', 'expert_id',  'experts',    'id', 'CASCADE'),
      ('proposal_documents',          'created_by', 'auth.users', 'id', 'SET NULL'),
      ('proposal_documents',          'expert_id',  'experts',    'id', 'SET NULL'),
      ('knowledge_base_documents',    'created_by', 'auth.users', 'id', 'SET NULL'),
      ('lessons_learned',             'created_by', 'auth.users', 'id', 'SET NULL'),
      ('contracts',                   'created_by', 'auth.users', 'id', 'SET NULL'),
      ('tasks',                       'created_by', 'auth.users', 'id', 'SET NULL'),
      ('meetings',                    'created_by', 'auth.users', 'id', 'SET NULL'),
      ('webhooks',                    'created_by', 'auth.users', 'id', 'SET NULL'),
      ('clients',                     'created_by', 'auth.users', 'id', 'SET NULL'),
      ('client_interactions',         'created_by', 'auth.users', 'id', 'SET NULL')
    ) AS t(tbl, col, ref_table, ref_col, on_delete)
  LOOP
    FOR fkcon IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      WHERE rel.relname = spec.tbl
        AND c.contype = 'f'
        AND spec.col = (
          SELECT a.attname FROM pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        )
        AND array_length(c.conkey, 1) = 1
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', spec.tbl, fkcon.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(%I) ON DELETE %s',
      spec.tbl, spec.tbl || '_' || spec.col || '_fkey', spec.col, spec.ref_table, spec.ref_col, spec.on_delete
    );
  END LOOP;
END $$;

-- ── H4: audit_logs had zero indexes beyond its primary key, despite ──
-- every read path (audit.html, reports.html, the dashboard) sorting by
-- timestamp and filtering by action/entity_type on an insert-only,
-- unboundedly-growing table.

CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx   ON audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx       ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_entity_type_idx  ON audit_logs (entity_type);

-- ── M5: default-sort columns on the two busiest list pages ──────────

CREATE INDEX IF NOT EXISTS opportunities_created_at_idx ON opportunities (created_at DESC);
CREATE INDEX IF NOT EXISTS contracts_created_at_idx     ON contracts (created_at DESC);

-- ── M6: comments can't have a real FK (entity_id is polymorphic across ──
-- opportunities/proposal_documents/clients), so deleting the parent left
-- its discussion-thread comments as permanently orphaned, invisible rows.
-- A cleanup trigger on each parent table removes its own comments when
-- the parent is deleted.

CREATE OR REPLACE FUNCTION delete_orphaned_comments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM comments WHERE entity_type = TG_ARGV[0] AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_cleanup_comments ON opportunities;
CREATE TRIGGER opportunities_cleanup_comments
  AFTER DELETE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION delete_orphaned_comments('opportunity');

DROP TRIGGER IF EXISTS proposal_documents_cleanup_comments ON proposal_documents;
CREATE TRIGGER proposal_documents_cleanup_comments
  AFTER DELETE ON proposal_documents
  FOR EACH ROW EXECUTE FUNCTION delete_orphaned_comments('proposal_document');

DROP TRIGGER IF EXISTS clients_cleanup_comments ON clients;
CREATE TRIGGER clients_cleanup_comments
  AFTER DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION delete_orphaned_comments('client');

-- ── M7: no floor on financial/quantity columns reachable via direct ──
-- API writes — nothing at the DB layer stopped a bad value from
-- corrupting budget totals summed client-side. CHECK allows NULL through
-- unchanged (all of these are nullable), so this doesn't touch existing
-- rows unless one is already negative.

ALTER TABLE opportunity_selected_experts ADD CONSTRAINT days_allocated_non_negative CHECK (days_allocated IS NULL OR days_allocated >= 0);
ALTER TABLE opportunity_selected_experts ADD CONSTRAINT daily_rate_usd_non_negative CHECK (daily_rate_usd IS NULL OR daily_rate_usd >= 0);
ALTER TABLE opportunity_expense_items    ADD CONSTRAINT quantity_non_negative       CHECK (quantity >= 0);
ALTER TABLE opportunity_expense_items    ADD CONSTRAINT unit_cost_usd_non_negative  CHECK (unit_cost_usd >= 0);
ALTER TABLE contracts                    ADD CONSTRAINT contract_value_non_negative CHECK (contract_value IS NULL OR contract_value >= 0);
ALTER TABLE contract_milestones          ADD CONSTRAINT amount_non_negative         CHECK (amount IS NULL OR amount >= 0);
ALTER TABLE experts                      ADD CONSTRAINT years_experience_non_negative CHECK (years_experience IS NULL OR years_experience >= 0);
ALTER TABLE experts                      ADD CONSTRAINT default_daily_rate_usd_non_negative CHECK (default_daily_rate_usd IS NULL OR default_daily_rate_usd >= 0);
