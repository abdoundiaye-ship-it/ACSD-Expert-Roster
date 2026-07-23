-- ================================================================
-- ACSD Expert Roster — Module 7: ACSD Proposal Repository (Knowledge Base)
-- Migration 0010
-- Run in: Supabase Dashboard → SQL Editor
--
-- A central library of past proposals, winning methodologies, project
-- references, donor-requirement notes, and templates that the proposal
-- generator draws on for style/precedent — organized into the same six
-- categories described in the original platform proposal.
-- ================================================================

CREATE TABLE IF NOT EXISTS knowledge_base_documents (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  category       text        NOT NULL CHECK (category IN
                    ('methodologies', 'technical_proposals', 'cvs', 'references', 'donor_requirements', 'templates')),
  title          text        NOT NULL,
  description    text,
  sector_id      smallint    REFERENCES sectors(id),   -- optional tag, used to pick relevant docs for a given opportunity
  donor_id       smallint    REFERENCES donors(id),     -- optional tag, most useful for donor_requirements
  file_storage_path text     NOT NULL,
  file_name      text        NOT NULL,
  -- Exact extracted text for DOCX/TXT uploads, or an AI-condensed digest
  -- for PDFs (Claude doesn't reliably transcribe long PDFs verbatim, so
  -- PDF uploads get a faithful summary instead — never presented as a
  -- verbatim quote). Capped in length at extraction time so it stays
  -- cheap to inject into generation prompts later.
  extracted_text text,
  created_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_documents_category_idx ON knowledge_base_documents (category);
CREATE INDEX IF NOT EXISTS kb_documents_sector_idx   ON knowledge_base_documents (sector_id);

ALTER TABLE knowledge_base_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb_documents_read"  ON knowledge_base_documents FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "kb_documents_admin" ON knowledge_base_documents FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- Storage bucket for the uploaded source files — mirrors expert-cvs /
-- opportunity-tors exactly (admin write, authenticated read).
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-base', 'knowledge-base', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "admin manage knowledge base files"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'knowledge-base' AND is_admin())
  WITH CHECK (bucket_id = 'knowledge-base' AND is_admin());

CREATE POLICY "authenticated view knowledge base files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'knowledge-base');
