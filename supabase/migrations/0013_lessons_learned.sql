-- ================================================================
-- ACSD Expert Roster — Module 7: Structured Lessons-Learned Database
-- Migration 0013
-- Run in: Supabase Dashboard → SQL Editor
--
-- A purpose-built post-mortem log, distinct from knowledge_base_documents
-- (which stores files). Each entry is a short structured record — what
-- happened, what to do differently (or repeat) next time — optionally
-- linked to the opportunity/project it came from, and tagged by sector/
-- donor so it can be surfaced automatically for a future, similar bid
-- (see generate-proposal-doc's fetchLessonsContext()).
-- ================================================================

CREATE TABLE IF NOT EXISTS lessons_learned (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id uuid        REFERENCES opportunities(id) ON DELETE SET NULL,
  title          text        NOT NULL,
  -- 'success' = a practice worth repeating; 'challenge' = a mistake or risk
  -- to avoid next time. Only 'challenge' entries are injected into future
  -- proposal drafts as risk-avoidance guidance — a repeated success doesn't
  -- need to steer a draft the way a past mistake does.
  lesson_type    text        NOT NULL CHECK (lesson_type IN ('success', 'challenge')),
  category       text        NOT NULL CHECK (category IN
                    ('proposal_process', 'technical_delivery', 'financial_budget',
                     'client_donor_relations', 'team_staffing', 'logistics_operations',
                     'compliance_eligibility', 'other')),
  what_happened  text,
  recommendation text        NOT NULL,
  sector_id      smallint    REFERENCES sectors(id),   -- optional tag, used to surface relevant lessons for a given opportunity
  donor_id       smallint    REFERENCES donors(id),     -- optional tag
  created_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lessons_learned_category_idx     ON lessons_learned (category);
CREATE INDEX IF NOT EXISTS lessons_learned_type_idx         ON lessons_learned (lesson_type);
CREATE INDEX IF NOT EXISTS lessons_learned_opportunity_idx  ON lessons_learned (opportunity_id);

ALTER TABLE lessons_learned ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lessons_learned_read"  ON lessons_learned FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "lessons_learned_admin" ON lessons_learned FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
