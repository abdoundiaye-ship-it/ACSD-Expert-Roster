-- ================================================================
-- ACSD Expert Roster — Bid/No-Bid Analysis
-- Migration 0009
-- Run in: Supabase Dashboard → SQL Editor
--
-- A holistic go/no-go recommendation, distinct from strategic_score
-- (which scores the opportunity's own attributes at intake time):
-- this factors in the actual matched/selected team and days remaining
-- before recommending whether to invest further effort in a full
-- proposal. Stored as a single overwritable snapshot, same pattern as
-- strategic_score_breakdown — regenerate any time, no history table.
-- ================================================================

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS bid_no_bid_analysis jsonb,
  ADD COLUMN IF NOT EXISTS bid_no_bid_computed_at timestamptz;
