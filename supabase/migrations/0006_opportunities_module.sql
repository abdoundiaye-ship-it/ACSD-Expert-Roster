-- ================================================================
-- ACSD Expert Roster — Opportunities / Matching / Proposal Module
-- Migration 0006
-- Run in: Supabase Dashboard → SQL Editor
--
-- Adds: TOR/opportunity intake, deterministic TOR<->expert matching,
-- selected-team + budget tracking, and generated proposal documents
-- (EOI, Technical Approach, Workplan, tailored CVs, Financial Proposal).
-- Reuses the existing controlled-vocabulary tables (sectors, languages,
-- geographies, donors, activity_types, work_order_roles) so matching
-- is a plain FK join against the same tables experts already use.
-- ================================================================

-- ── 1. Opportunities ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opportunities (
  id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  title                   text        NOT NULL,
  organization            text        NOT NULL,
  donor_id                smallint    REFERENCES donors(id),
  primary_country_id      smallint    REFERENCES geographies(id),
  opportunity_type        text        NOT NULL CHECK (opportunity_type IN ('RFP','EOI','RFQ','REOI')),
  deadline                date,
  status                  text        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','in_progress','submitted','won','lost','archived')),
  strategic_score         smallint    CHECK (strategic_score BETWEEN 0 AND 100),
  strategic_score_rationale text,
  evaluation_criteria     jsonb,
  summary                 text,
  source_file_storage_path text,
  source_file_name        text,
  raw_extracted_json      jsonb,
  created_by              uuid        REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS opportunities_updated_at ON opportunities;
CREATE TRIGGER opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS opportunities_status_idx   ON opportunities (status);
CREATE INDEX IF NOT EXISTS opportunities_deadline_idx ON opportunities (deadline);

-- ── 2. Requirement junctions (mirror expert_* junctions 1:1) ──────

CREATE TABLE IF NOT EXISTS opportunity_sectors (
  opportunity_id uuid     NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  sector_id      smallint NOT NULL REFERENCES sectors(id),
  importance     text     NOT NULL DEFAULT 'required' CHECK (importance IN ('required','preferred')),
  PRIMARY KEY (opportunity_id, sector_id)
);

CREATE TABLE IF NOT EXISTS opportunity_languages (
  opportunity_id uuid     NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  language_id    smallint NOT NULL REFERENCES languages(id),
  PRIMARY KEY (opportunity_id, language_id)
);

CREATE TABLE IF NOT EXISTS opportunity_geographies (
  opportunity_id uuid     NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  geography_id   smallint NOT NULL REFERENCES geographies(id),
  PRIMARY KEY (opportunity_id, geography_id)
);

CREATE TABLE IF NOT EXISTS opportunity_activity_types (
  opportunity_id  uuid     NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  activity_type_id smallint NOT NULL REFERENCES activity_types(id),
  PRIMARY KEY (opportunity_id, activity_type_id)
);

-- No opportunity_donors junction — a TOR has one funder/client, so
-- opportunities.donor_id (single FK) is enough; donor-experience
-- matching compares expert_donor_experience against that one id.

-- ── 3. Positions — the actual roles a TOR asks for ────────────────

CREATE TABLE IF NOT EXISTS opportunity_positions (
  id                       uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id           uuid        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  role_title               text        NOT NULL,
  work_order_role_id       smallint    REFERENCES work_order_roles(id),
  required_seniority_tier  text        CHECK (required_seniority_tier IN ('junior','intermediary','senior','principal_expert')),
  required_sector_id       smallint    REFERENCES sectors(id),
  quantity                 smallint    NOT NULL DEFAULT 1,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_positions_opp_idx ON opportunity_positions (opportunity_id);

-- ── 4. Deterministic match scores (recomputable, auditable) ───────

CREATE TABLE IF NOT EXISTS opportunity_expert_matches (
  id                      uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id          uuid          NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_position_id uuid          REFERENCES opportunity_positions(id) ON DELETE CASCADE,
  expert_id               uuid          NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  match_score             numeric(5,2)  NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  score_breakdown         jsonb         NOT NULL,
  ai_justification        text,
  computed_at             timestamptz   NOT NULL DEFAULT now()
);

-- one row per (opportunity, position-or-null, expert)
CREATE UNIQUE INDEX IF NOT EXISTS opp_match_with_position
  ON opportunity_expert_matches (opportunity_id, opportunity_position_id, expert_id)
  WHERE opportunity_position_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS opp_match_without_position
  ON opportunity_expert_matches (opportunity_id, expert_id)
  WHERE opportunity_position_id IS NULL;
CREATE INDEX IF NOT EXISTS opp_match_score_idx
  ON opportunity_expert_matches (opportunity_id, match_score DESC);

-- ── 5. Selected team, with per-expert day-rate for the budget ─────

CREATE TABLE IF NOT EXISTS opportunity_selected_experts (
  id                       uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id           uuid          NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_position_id  uuid          REFERENCES opportunity_positions(id) ON DELETE SET NULL,
  expert_id                uuid          NOT NULL REFERENCES experts(id),
  assigned_role_title      text          NOT NULL,
  status                   text          NOT NULL DEFAULT 'shortlisted'
                              CHECK (status IN ('shortlisted','selected','confirmed')),
  days_allocated           numeric(6,1),
  daily_rate_usd           numeric(10,2),
  notes                    text,
  added_by                 uuid          REFERENCES auth.users(id),
  created_at                timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, opportunity_position_id, expert_id)
);

CREATE INDEX IF NOT EXISTS opp_selected_experts_opp_idx ON opportunity_selected_experts (opportunity_id);

-- ── 6. Non-fee budget lines (travel / per diem / other) ───────────

CREATE TABLE IF NOT EXISTS opportunity_expense_items (
  id             uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id uuid          NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  category       text          NOT NULL CHECK (category IN ('travel','per_diem','other')),
  expert_id      uuid          REFERENCES experts(id) ON DELETE SET NULL,
  description    text          NOT NULL,
  quantity       numeric(8,2)  NOT NULL DEFAULT 1,
  unit_cost_usd  numeric(10,2) NOT NULL DEFAULT 0,
  notes          text,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opp_expense_items_opp_idx ON opportunity_expense_items (opportunity_id);

-- ── 7. ACSD standard day-rate default (used to prefill Team tab) ──

ALTER TABLE experts
  ADD COLUMN IF NOT EXISTS default_daily_rate_usd numeric(10,2);

-- ── 8. Generated proposal documents ────────────────────────────────
-- doc_type='budget' is assembled deterministically client-side
-- (generated_by_ai=false, ai_prompt_snapshot=null); the other four
-- are Claude drafts requiring human review before export.

CREATE TABLE IF NOT EXISTS proposal_documents (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id      uuid        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  doc_type            text        NOT NULL
                        CHECK (doc_type IN ('eoi','technical_approach','workplan','expert_cv','budget')),
  expert_id           uuid        REFERENCES experts(id),
  title               text        NOT NULL,
  content_html        text        NOT NULL,
  status              text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','final')),
  generated_by_ai      boolean    NOT NULL DEFAULT true,
  ai_prompt_snapshot   text,
  created_by           uuid       REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_cv_requires_expert CHECK (doc_type <> 'expert_cv' OR expert_id IS NOT NULL)
);

DROP TRIGGER IF EXISTS proposal_documents_updated_at ON proposal_documents;
CREATE TRIGGER proposal_documents_updated_at
  BEFORE UPDATE ON proposal_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS one_doc_per_type_no_expert
  ON proposal_documents (opportunity_id, doc_type) WHERE expert_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_doc_per_type_per_expert
  ON proposal_documents (opportunity_id, doc_type, expert_id) WHERE expert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS proposal_documents_opp_idx ON proposal_documents (opportunity_id);

-- ── 9. Row Level Security — same convention as every other table:
--       authenticated read, admin write ───────────────────────────

ALTER TABLE opportunities                ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_sectors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_languages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_geographies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_activity_types   ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_positions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_expert_matches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_selected_experts ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_expense_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_documents           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opportunities_read"  ON opportunities FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opportunities_admin" ON opportunities FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "opp_sectors_read"  ON opportunity_sectors FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opp_sectors_admin" ON opportunity_sectors FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "opp_languages_read"  ON opportunity_languages FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opp_languages_admin" ON opportunity_languages FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "opp_geographies_read"  ON opportunity_geographies FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opp_geographies_admin" ON opportunity_geographies FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "opp_activity_types_read"  ON opportunity_activity_types FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opp_activity_types_admin" ON opportunity_activity_types FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "opp_positions_read"  ON opportunity_positions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opp_positions_admin" ON opportunity_positions FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "opp_matches_read"  ON opportunity_expert_matches FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opp_matches_admin" ON opportunity_expert_matches FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "opp_selected_experts_read"  ON opportunity_selected_experts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opp_selected_experts_admin" ON opportunity_selected_experts FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "opp_expense_items_read"  ON opportunity_expense_items FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "opp_expense_items_admin" ON opportunity_expense_items FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "proposal_documents_read"  ON proposal_documents FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "proposal_documents_admin" ON proposal_documents FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 10. Storage bucket for uploaded TOR/RFP source files ──────────
-- Mirrors the existing expert-cvs bucket exactly (admin write, authenticated read).

INSERT INTO storage.buckets (id, name, public)
VALUES ('opportunity-tors', 'opportunity-tors', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "admin manage tor files"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'opportunity-tors' AND is_admin())
  WITH CHECK (bucket_id = 'opportunity-tors' AND is_admin());

CREATE POLICY "authenticated view tor files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'opportunity-tors');
