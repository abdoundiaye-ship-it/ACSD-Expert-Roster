-- ================================================================
-- ACSD Expert Roster — Opportunity reference number
-- Migration 0007
-- Run in: Supabase Dashboard → SQL Editor
--
-- Formal RFP/TOR solicitation number (e.g. "RFP DDP-SEN-DKR-2026-05"),
-- shown on the combined Final Report's cover page and page headers.
-- ================================================================

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS reference_number text;
