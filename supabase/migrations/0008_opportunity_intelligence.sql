-- ================================================================
-- ACSD Expert Roster — Module 1: AI Opportunity Intelligence
-- Migration 0008
-- Run in: Supabase Dashboard → SQL Editor
--
-- Adds a monitored-source registry and upgrades opportunities' scoring
-- to a 5-criteria breakdown (Alignement thématique / Adéquation
-- géographique / Éligibilité & conformité / Valeur stratégique /
-- Faisabilité opérationnelle), consistent across manual TOR uploads,
-- pasted quick-intake notices, and automated API-sourced scans.
-- ================================================================

-- ── 1. Monitored sources ("sources +/-" registry) ──────────────────

CREATE TABLE IF NOT EXISTS intelligence_sources (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name          text        NOT NULL UNIQUE,
  portal_url    text,
  access_method text        NOT NULL CHECK (access_method IN ('api', 'rss', 'email_digest', 'manual_paste')),
  active        boolean     NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE intelligence_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intelligence_sources_read"  ON intelligence_sources FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "intelligence_sources_admin" ON intelligence_sources FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- Seeded from the source list in the Module 1 spec, each annotated with
-- what the 2026-07-23 access pilot actually found (see plan doc) rather
-- than assumed capability.
INSERT INTO intelligence_sources (name, portal_url, access_method, notes) VALUES
  ('World Bank Procurement Notices', 'https://search.worldbank.org/api/procnotices', 'api',
    'Confirmed working: free, public, structured JSON, no auth wall. Wired into scan-opportunities.'),
  ('UNGM (UN Global Marketplace)', 'https://www.ungm.org', 'email_digest',
    'No public API — real listings are behind a JS-rendered search UI. Offers a native daily email digest filterable by sector/geography; register and paste relevant notices.'),
  ('ReliefWeb', 'https://reliefweb.int', 'api',
    'Has a real public API (api.reliefweb.int) but requires a pre-approved app name — returned 403 with an ad-hoc name in testing. Register an app name before wiring in.'),
  ('AfDB (African Development Bank)', 'https://www.afdb.org/en/projects-and-operations/procurement', 'manual_paste',
    'Advertises RSS/email alerts on its procurement pages, but the page itself returned HTTP 403 to a basic fetch in testing — needs re-verification from a real server context before trusting RSS.'),
  ('Danish Refugee Council (DRC)', 'https://drc.ngo/about-us/who-we-are/tenders/', 'manual_paste',
    'General tender listing page served a stale cached snapshot (Dec 2022) in testing. Individual notice detail pages (found via search) work fine — paste specific notice links/text.'),
  ('UNDP Procurement', 'https://procurement-notices.undp.org/', 'manual_paste', 'Not yet tested for API/RSS access — generic search returned only institutional pages, not live notices.'),
  ('UNHCR', 'https://www.unhcr.org/get-involved/work-us/become-supplier/bidding-opportunities', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('UNICEF', 'https://www.unicef.org/supply/procurement', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('WFP (World Food Programme)', 'https://www.wfp.org/supplier-portal', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('FAO', 'https://www.fao.org/procurement/', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('UNFPA', 'https://www.unfpa.org/procurement', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('OIM / IOM', 'https://www.iom.int/procurement', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('OCHA', 'https://www.unocha.org/about-us/procurement', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('ONU Femmes / UN Women', 'https://www.unwomen.org/en/about-us/procurement', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('Union européenne (TED / EuropeAid-FPI)', 'https://ted.europa.eu', 'manual_paste', 'Not yet tested for API/RSS access — TED does publish open datasets, worth revisiting.'),
  ('GIZ', 'https://www.giz.de/en/workingwithgiz/procurement.html', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('MCC (Millennium Challenge Corporation)', 'https://www.mcc.gov/work-with-us/notices', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('DevelopmentAid', 'https://www.developmentaid.org/tenders', 'api',
    'Real tenders/grants API exists ("real-time synchronization") but is paid (Premium/Procurement membership); the limited-time free API trial had already lapsed as of this review. Revisit if ACSD wants to invest.'),
  ('DGMarket', 'https://tenders.dgmarket.com', 'manual_paste', 'No documented public API found; large commercial aggregator, likely needs direct inquiry.'),
  ('Mastercard Foundation', 'https://mastercardfdn.org/en/opportunities/', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('Gates Foundation', 'https://www.gatesfoundation.org/about/how-we-work/general-information/how-to-apply', 'manual_paste', 'Not yet tested for API/RSS access.'),
  ('Portails nationaux de marchés publics (pays cibles)', NULL, 'manual_paste', 'Varies by country — no single integration point; paste notices as found.')
ON CONFLICT (name) DO NOTHING;

-- ── 2. Upgrade opportunities' scoring to the 5-criteria rubric ────

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'tor_upload', 'quick_intake', 'api_scan')),
  ADD COLUMN IF NOT EXISTS strategic_score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS strategic_score_confidence text NOT NULL DEFAULT 'confirmed'
    CHECK (strategic_score_confidence IN ('confirmed', 'to_confirm'));

CREATE INDEX IF NOT EXISTS opportunities_source_idx ON opportunities (source);
