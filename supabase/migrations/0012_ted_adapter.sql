-- ================================================================
-- ACSD Expert Roster — Module 1: Additional Donor-Portal Adapter (TED)
-- Migration 0012
-- Run in: Supabase Dashboard → SQL Editor
--
-- Corrects two access_method classifications in intelligence_sources based
-- on a live pilot run 2026-07-28 (curl-tested against both APIs directly,
-- not assumed from documentation):
--
-- 1. Union européenne (TED / EuropeAid-FPI) — the migration 0008 seed
--    flagged this "not yet tested, worth revisiting". It's now confirmed:
--    api.ted.europa.eu/v3/notices/search is free, public JSON, no auth
--    wall, and its structured place-of-performance-country filter returns
--    real, relevant technical-assistance/consulting notices (e.g. GIZ,
--    Enabel, and other EU member-state development-cooperation tenders
--    located in ACSD's priority countries). Wired into scan-opportunities
--    (see supabase/functions/scan-opportunities/index.ts, scanTed()).
--
-- 2. ReliefWeb — the migration 0008 seed marked this 'api' on the
--    assumption a pre-approved appname would unlock it as an opportunity
--    source. Testing the actual API surface (reports/jobs/training/
--    disasters) found no procurement/tender content type at all — "jobs"
--    are individual humanitarian-sector employment vacancies, not firm-
--    level contracting opportunities. There is nothing here for
--    scan-opportunities to ingest as an "opportunity", so this corrects
--    the source back to manual_paste rather than leaving a misleading
--    'api' tag that implies an automated adapter is coming.
-- ================================================================

UPDATE intelligence_sources
SET access_method = 'api',
    notes = 'Confirmed working 2026-07-28: api.ted.europa.eu/v3/notices/search is free, public JSON, no auth wall. Filtered on place-of-performance-country for ACSD''s priority countries — returns real EU member-state development-cooperation tenders (GIZ, Enabel, etc.) located in those countries. Wired into scan-opportunities.'
WHERE name = 'Union européenne (TED / EuropeAid-FPI)';

UPDATE intelligence_sources
SET access_method = 'manual_paste',
    notes = 'API confirmed reachable (returns a clear 403 requiring a pre-approved appname), but its only content types — situation reports, individual job vacancies, training courses, disaster records — do not include procurement or tender notices. Nothing here maps to an "opportunity" for this platform, so it is not a scan-opportunities candidate regardless of appname approval. Left as manual_paste in case a report is ever worth a one-off reference entry.'
WHERE name = 'ReliefWeb';
