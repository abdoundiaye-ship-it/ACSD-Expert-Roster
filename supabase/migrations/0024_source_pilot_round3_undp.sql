-- ================================================================
-- ACSD Expert Roster — Third source pilot: UNDP scrape adapter +
-- deeper follow-up on the remaining 12 sources from migration 0023
-- Migration 0024
-- Run in: Supabase Dashboard → SQL Editor
--
-- Live-tested 2026-08-04, same discipline as migrations 0012/0023.
--
-- 1. UNDP Procurement — real win. procurement-notices.undp.org has no
--    RSS/API, but the page itself is plain server-rendered HTML with a
--    clean, consistent structure: each notice is a
--    view_negotiation.cfm?nego_id=NNNNN link wrapping labeled cells
--    (Title, Ref No, UNDP Office/Country, Process, Deadline, Posted), with
--    Deadline in a real parseable date format ("13-Aug-26"). Wired into
--    scan-opportunities via a new bespoke adapter (scanUndp, HTML-scrape
--    rather than JSON, but automated the same way WB/TED are) —
--    reclassified to access_method='api'.
--
-- 2. FAO, WFP — both now route procurement exclusively through UN Global
--    Marketplace (UNGM) per their own current guidance (confirmed via
--    search, not assumed) rather than maintaining independent listings.
--    Tried the same UNGM per-agency RSS pattern that worked for UN Women
--    (migration 0023) — RSSNoticesForFAO / RSSNoticesForWFP both 404, so
--    neither has a self-service feed slug the way UN Women does. portal_url
--    updated to UNGM's general notice search (confirmed reachable); still
--    manual_paste — filter by "UN Organization" = FAO/WFP there by hand.
--
-- 3. UNHCR — its own page is reachable after all (was blocking curl's
--    default user-agent, not a real bot-wall — confirmed by refetching
--    with a realistic browser UA). It only links out to UNGM generally,
--    no UNHCR-specific feed found. Still manual_paste, notes corrected
--    (previous "portal blocked" note was a false read from an under-
--    powered test, not a dead source).
--
-- 4. IOM, UNICEF — genuinely still blocked even with a realistic browser
--    user-agent and headers — real bot protection, not simple UA-sniffing.
--    Confirmed dead end for a plain fetch; still manual_paste.
--
-- 5. OCHA — no dedicated procurement/tender page found anywhere (it's a
--    coordination body, not a large operational procurer the way
--    UNDP/WFP/UNICEF are) — portal_url corrected from the dead specific
--    path to the reachable site root as a more honest starting point for
--    manual monitoring. Still manual_paste.
--
-- 6. MCC — its real live listings are hosted on a third-party aggregator
--    (mcc.dgmarket.com per MCC's own guidance), which requires a session
--    cookie and blocks plain HTTP fetches entirely — confirmed dead end
--    for automation, not just "needs a nicer URL". portal_url corrected
--    to MCC's own current "Do Business With MCC" page (confirmed
--    reachable) for whoever does the manual check; notes explain the
--    dgMarket dependency so this isn't re-investigated as an RSS/API
--    candidate later.
--
-- 7. Gates Foundation — corrected portal_url (the seeded one 404'd; the
--    current page was found via search and confirmed reachable). No feed.
--    Also worth knowing for manual monitoring: Gates rarely runs public,
--    open RFPs — most funding is by direct invitation — so this source is
--    inherently low-yield even by hand, not just unautomatable.
--
-- 8. Mastercard Foundation — corrected portal_url: the seeded /en/
--    opportunities/ URL redirects into a loop on the foundation's own
--    site (a bug on their end, not a dead page); the working equivalent
--    is /opportunities/ (no /en/ prefix), confirmed reachable. No feed,
--    and no RFP/deadline-shaped content found on that page at test time.
--
-- 9. GIZ, UNFPA — reachable (HTTP 200), no RSS/API found. Unlike UNDP,
--    this round did not check whether either page's own listing markup
--    is structured enough for a bespoke scrape adapter the way UNDP's
--    turned out to be — worth a closer look if either becomes a priority,
--    rather than assumed impossible.
-- ================================================================

UPDATE intelligence_sources
SET access_method = 'api',
    notes = 'Confirmed working 2026-08-04: no RSS/API, but procurement-notices.undp.org is plain server-rendered HTML with a consistent structure (Title/Ref No/Office-Country/Process/Deadline per notice, real parseable deadline dates). Wired into scan-opportunities via a bespoke HTML-scrape adapter (scanUndp) — automated the same way World Bank/TED are, just parsing HTML instead of JSON.'
WHERE name = 'UNDP Procurement';

UPDATE intelligence_sources
SET portal_url = 'https://www.ungm.org/Public/Notice',
    notes = 'Re-tested 2026-08-04 (see migration 0024): this agency now routes procurement exclusively through UN Global Marketplace (UNGM) per its own current guidance. Tried the UNGM per-agency RSS pattern that worked for UN Women (RSSNoticesFor<name>) — 404, so no self-service feed slug exists for this agency. Still manual_paste: on the UNGM notice search (portal_url above), use "Show more criteria" and filter UN Organization to this agency''s name.'
WHERE name IN ('FAO', 'WFP (World Food Programme)');

UPDATE intelligence_sources
SET notes = 'Re-tested 2026-08-04 (see migration 0024): portal_url is actually reachable — the earlier "blocked" read (migration 0023) was curl''s default user-agent being rejected, not a real bot-wall; a realistic browser user-agent loads it fine. The page only links out to UNGM generally though, no UNHCR-specific feed or listing found there. Still manual_paste.'
WHERE name = 'UNHCR';

UPDATE intelligence_sources
SET notes = 'Re-tested 2026-08-04 with a realistic browser user-agent and headers (see migration 0024), not just curl''s bare default — still HTTP 403. This is real bot protection, not simple user-agent sniffing, and not something a plain server-side fetch can get past. Confirmed dead end for automation. Still manual_paste.'
WHERE name IN ('UNICEF', 'OIM / IOM');

UPDATE intelligence_sources
SET portal_url = 'https://www.unocha.org/',
    notes = 'Re-tested 2026-08-04 (see migration 0024): no dedicated procurement/tender page could be found anywhere on this site — OCHA is a coordination body rather than a large direct procurer the way UNDP/WFP/UNICEF are, so this may simply not be a strong source for tender notices. portal_url corrected from the dead specific path (404) to the reachable site root as an honest starting point. Still manual_paste.'
WHERE name = 'OCHA';

UPDATE intelligence_sources
SET portal_url = 'https://www.mcc.gov/work-with-us/mcc-business/',
    notes = 'Re-tested 2026-08-04 (see migration 0024): MCC''s real live procurement listings are hosted on a third-party aggregator, mcc.dgmarket.com, which requires a session cookie and rejects plain HTTP fetches outright ("This page requires digi_session_id cookie") — confirmed dead end for automation, not just a URL problem. portal_url corrected from the dead 404''d path to MCC''s own current "Do Business With MCC" page (confirmed reachable) as the practical starting point for manual monitoring. Still manual_paste.'
WHERE name = 'MCC (Millennium Challenge Corporation)';

UPDATE intelligence_sources
SET portal_url = 'https://www.gatesfoundation.org/about/how-we-work/grant-opportunities',
    notes = 'Re-tested 2026-08-04 (see migration 0024): seeded portal_url 404''d; corrected to the current live grant-opportunities page (confirmed reachable). No feed found. Also worth knowing for manual monitoring: the foundation rarely runs public, open RFPs — most funding is by direct invitation — so this source is inherently low-yield even by hand, not only unautomatable.'
WHERE name = 'Gates Foundation';

UPDATE intelligence_sources
SET portal_url = 'https://mastercardfdn.org/opportunities/',
    notes = 'Re-tested 2026-08-04 (see migration 0024): the seeded /en/opportunities/ URL hits a redirect loop on the foundation''s own site (a bug on their end); the working equivalent without the /en/ prefix is confirmed reachable and corrected above. No feed, and no RFP/deadline-shaped content found on the page at test time. Still manual_paste.'
WHERE name = 'Mastercard Foundation';

UPDATE intelligence_sources
SET notes = 'Re-tested 2026-08-04 (see migration 0024): page reachable, no RSS/API found. Unlike UNDP''s procurement site, this round did not check whether the page''s own listing markup is structured enough for a bespoke scrape adapter — worth a closer look if this source becomes a priority, rather than assumed impossible.'
WHERE name IN ('UNFPA', 'GIZ');
