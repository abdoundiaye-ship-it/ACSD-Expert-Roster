-- ================================================================
-- ACSD Expert Roster — Grants.gov is now wired into scan-opportunities
-- Migration 0030
-- Run in: Supabase Dashboard → SQL Editor
--
-- A Grants.gov API key was provisioned (stored as the GRANTS_GOV_API_KEY
-- Edge Function secret, not in this table) and scan-opportunities got a
-- real scanGrantsGov adapter. Flips the source from manual_paste to api
-- so it's picked up by both the "Scan Sources" button and the daily
-- scheduled scan (migration 0011).
-- ================================================================

UPDATE intelligence_sources
SET access_method = 'api',
    notes = 'Official US federal grants portal. Wired into scan-opportunities via its "Simpler Grants" API (api.simpler.grants.gov) using a provisioned API key stored as the GRANTS_GOV_API_KEY secret. Searches ACSD''s priority countries by name (the API has no geography filter) and lets Claude''s scoring judge actual eligibility/relevance from each notice''s own text.'
WHERE name = 'Grants.gov';
