-- ================================================================
-- ACSD Expert Roster — Second source-testing pilot (the 13 sources
-- migration 0008 seeded as "Not yet tested for API/RSS access")
-- Migration 0023
-- Run in: Supabase Dashboard → SQL Editor
--
-- Live-tested 2026-08-04 (curl-tested against each portal directly, same
-- discipline as migration 0012's TED/ReliefWeb pilot — not assumed from
-- documentation).
--
-- 1. UN Women — confirmed working. Its procurement page links to a
--    UN Global Marketplace (UNGM) feed scoped to just this agency:
--    https://www.ungm.org/Public/Notice/RSSNoticesForUNWomen — valid RSS
--    2.0, 37 live items at test time, deadline stated in each item's own
--    description text ("Deadline: DD Month YYYY"). Wired into
--    scan-opportunities via the new generic scanRssSource adapter (any
--    source tagged 'rss' works automatically, no per-source code needed).
--
-- 2. The other 12 (UNDP, UNHCR, UNICEF, WFP, FAO, UNFPA, IOM, OCHA, GIZ,
--    MCC, Mastercard Foundation, Gates Foundation) — each portal page was
--    fetched directly and checked for a declared RSS/Atom feed
--    (<link type="application/rss+xml">) and for any UNGM-style
--    agency-specific feed link the way UN Women's page had. None found:
--    UNHCR/UNICEF/WFP/FAO/IOM/OCHA/MCC/Gates Foundation returned HTTP
--    403/404 on their seeded portal_url (bot-blocked or the page moved);
--    UNDP/UNFPA/GIZ returned HTTP 200 but exposed no feed link anywhere
--    on the page. Guessing UNGM's per-agency URL pattern
--    (RSSNoticesFor<AgencyAcronym>) for these nine also came back 404 for
--    every one — UN Women's slug isn't a predictable acronym match, so
--    each agency's own feed (if one exists) would need to be found
--    individually rather than guessed. Left as manual_paste; notes
--    updated so a future admin doesn't re-spend time on the same
--    already-checked dead ends.
-- ================================================================

UPDATE intelligence_sources
SET access_method = 'rss',
    portal_url = 'https://www.ungm.org/Public/Notice/RSSNoticesForUNWomen',
    notes = 'Confirmed working 2026-08-04: linked from unwomen.org''s own procurement page as a UN Global Marketplace (UNGM) feed scoped to this agency. Valid RSS 2.0, 37 live items at test time. Each item''s description states its deadline as free text ("Deadline: DD Month YYYY") — scan-opportunities'' generic RSS adapter does not parse this out into the structured deadline field (no standard field for it), so set deadlines manually after reviewing new items from this source.'
WHERE name = 'ONU Femmes / UN Women';

UPDATE intelligence_sources
SET notes = 'Re-tested 2026-08-04 (part of the second source pilot, see migration 0023): portal_url returns HTTP 403/404 to a direct fetch (bot-blocked or the page has moved), and no RSS/Atom feed or UNGM-style agency feed link was found. Still manual_paste — paste specific notices as found.'
WHERE name IN ('UNHCR', 'UNICEF', 'WFP (World Food Programme)', 'FAO', 'OIM / IOM', 'OCHA', 'MCC (Millennium Challenge Corporation)', 'Gates Foundation');

UPDATE intelligence_sources
SET notes = 'Re-tested 2026-08-04 (part of the second source pilot, see migration 0023): portal page loads fine but exposes no RSS/Atom feed or UNGM-style agency feed link anywhere on the page. Still manual_paste — paste specific notices as found.'
WHERE name IN ('UNDP Procurement', 'UNFPA', 'GIZ');

UPDATE intelligence_sources
SET notes = 'Re-tested 2026-08-04 (part of the second source pilot, see migration 0023): portal_url returned HTTP 301 (page moved) before a feed check could complete — worth a fresh look at the current opportunities/grants page URL, not confirmed dead the way the others above are. Still manual_paste.'
WHERE name = 'Mastercard Foundation';
