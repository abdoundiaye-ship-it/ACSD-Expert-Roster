-- ================================================================
-- ACSD Expert Roster — store a link to the original external posting
-- Migration 0028
-- Run in: Supabase Dashboard → SQL Editor
--
-- scan-opportunities (World Bank / TED / UNDP / generic RSS adapters)
-- already resolves each notice's own public page — this column lets
-- that link be stored on the opportunity itself, so admins can open
-- the original posting directly (and exports, e.g. the Opportunities
-- Excel export, can include it) instead of only having the internal
-- record with no way back to the source.
-- ================================================================

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS source_url text;
