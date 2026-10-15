-- ================================================================
-- ACSD Expert Roster — add SAM.gov and Grants.gov as trusted sources
-- Migration 0029
-- Run in: Supabase Dashboard → SQL Editor
--
-- Both are official US Government procurement/funding portals. Checked
-- 2026-10-15: both have a real public API (SAM.gov Opportunities API at
-- api.sam.gov; Grants.gov's "Simpler Grants" API at api.simpler.grants.gov),
-- but each requires a free API key obtained through a self-service
-- registration flow (open.gsa.gov for SAM.gov, the Simpler Grants web UI
-- for Grants.gov) — not something that can be provisioned unattended.
-- Seeded as manual_paste for now; flip to 'api' and wire a scan-opportunities
-- adapter once a key has been requested and stored as a secret.
-- ================================================================

INSERT INTO intelligence_sources (name, portal_url, access_method, notes) VALUES
  ('SAM.gov (System for Award Management)',
   'https://sam.gov/search/?page=1&pageSize=25&sort=-modifiedDate&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5Bstatus%5D%5Bis_active%5D=true',
   'manual_paste',
   'Official US federal contract opportunities portal. Has a real public API (api.sam.gov/opportunities/v2/search) but it requires a free API key via self-service registration at open.gsa.gov — not yet provisioned. Paste notices found via the search link for now; revisit as an "api" source once a key is obtained.'),
  ('Grants.gov',
   'https://simpler.grants.gov/es/search?utm_source=Grants.gov',
   'manual_paste',
   'Official US federal grants portal. Its new "Simpler Grants" API (api.simpler.grants.gov, POST /v1/opportunities/search) requires an API key via self-service registration — not yet provisioned. Paste notices found via the search link for now; revisit as an "api" source once a key is obtained.')
ON CONFLICT (name) DO NOTHING;
