# ACSD Expert Intelligence Platform

Started as a searchable, manageable database of experts for ACSD's response to RFP DDP-SEN-DKR-2026-05
(Framework Agreement for Technical Support Services — Pool of Experts, SRF FMU, DRC), and has grown into
the full platform described in `ACSD_Expert_Intelligence_Platform_Proposal.pdf`: the expert roster below
is Module 2 of that platform, alongside opportunity sourcing/qualification, a TOR↔expert matching engine,
AI-assisted proposal generation, a financial proposal assistant, a proposal knowledge base, bid/no-bid
analysis, and natural-language roster search — see the module sections further down this file.

## Stack
- **Database & API**: Supabase (PostgreSQL + auto-generated REST API + Row Level Security)
- **Auth**: Supabase Auth (admin / viewer roles)
- **Storage**: Supabase Storage (private bucket for CV PDFs)
- **Frontend**: HTML/CSS/JS, deployed via GitHub Pages

## Project structure
```
supabase/
  migrations/        SQL schema migrations
```

## Schema overview
- `experts` — core profile (name, title, affiliation, seniority tier, availability, CV link)
- `sectors`, `expert_sectors` — 23 priority sectors from the TOR, primary/secondary tagging
- `languages`, `expert_languages` — languages spoken with proficiency
- `geographies`, `expert_geographies` — country/region experience
- `donor_categories`, `donors`, `expert_donor_experience` — humanitarian / development / private-sector donor experience
- `activity_types`, `expert_activity_experience` — deliverable types each expert has produced
- `work_order_roles`, `expert_role_fit` — fit against TOR work-order types
- `education_certifications` — degrees and certifications
- `user_roles` — admin/viewer access control

## Status
- [x] Phase 0 — Controlled vocabulary extracted from TOR/RFP/Financial Proposal
- [x] Phase 1 — Database schema + RLS policies + storage bucket (`supabase/migrations/0001_init_schema.sql`)
- [x] Phase 2 — CV data extraction (~73 experts loaded across core/partner/KNUST-IRDIS batches)
- [x] Phase 3 — Human QA review
- [x] Phase 4 — Frontend (search/filter/admin CRUD)
- [x] Phase 5 — Reporting/export

## ACSD Expert Intelligence Platform (MVP v1.0)

Built on top of the roster above: TOR/opportunity intake, a deterministic TOR↔expert matching engine, an AI proposal-document generator, and a Financial Proposal Assistant. See `supabase/migrations/0006_opportunities_module.sql` for schema, `supabase/functions/{analyze-tor,compute-matches,generate-proposal-doc}` for the Edge Functions, and `docs/admin/{opportunities,opportunity-detail}.html` for the UI.

- [x] Opportunity/TOR intake — manual entry + AI extraction (`analyze-tor`) with strategic scoring
- [x] TOR↔Expert matching engine — deterministic weighted scoring (`compute-matches`), AI justification for top candidates
- [x] Team assembly — shortlist/select experts per position, assign roles
- [x] Proposal document generator — EOI, Technical Approach, Workplan, tailored CVs (`generate-proposal-doc`), all editable AI drafts
- [x] Financial Proposal Assistant — per-expert day-rate × days + travel/per-diem expense lines, auto-calculated budget recap
- [x] Export — Word (all doc types) and PDF (tabular via jsPDF/autoTable, narrative via html2canvas)
- [x] Combined Final Report — cover page + executive summary + all documents in one Word/PDF, gated on every component being marked Reviewed/Final first

**Before use:** run `supabase/migrations/0006_opportunities_module.sql` in the Supabase SQL Editor and deploy the three new Edge Functions (`supabase functions deploy analyze-tor compute-matches generate-proposal-doc`) — they reuse the same `ANTHROPIC_API_KEY` secret already configured for `analyze-cv`.

## Module 1 — AI Opportunity Intelligence (sourcing & qualification)

Proactive opportunity sourcing and 5-criteria qualification scoring (Alignement thématique / Adéquation géographique / Éligibilité & conformité / Valeur stratégique / Faisabilité opérationnelle), on top of the MVP above. See `supabase/migrations/0008_opportunity_intelligence.sql` for schema, `supabase/functions/scan-opportunities` for the World Bank ingestion adapter, `analyze-tor`'s extended `text`/`source_url` inputs for the paste-intake flow, and `docs/admin/sources.html` for the monitored-source registry.

A live access pilot (before building this) found that most donor portals (UNGM, AfDB, ReliefWeb without a registered app name, etc.) aren't reliably scrapable via simple HTTP fetch — so this module is intentionally tiered rather than a blanket "scrape everything" pipeline:

- [x] **Automated** — two working adapters today: **World Bank** Procurement Notices API and the **EU's TED** (Tenders Electronic Daily) open-data API, both free, public, and requiring no API key. The "Scan Sources" button opens a picker over every source tagged `api` in the registry (select one, several, or all), fetches recent notices, dedupes against existing opportunities, scores and inserts new ones automatically (`status='archived'` for anything scoring REJET/<50). Other `api`-tagged sources (DevelopmentAid — paid, trial lapsed) are selectable but report "no automated adapter implemented yet" per-source until wired in, rather than silently doing nothing. See `supabase/functions/scan-opportunities`'s `SOURCE_ADAPTERS` lookup — adding a source is a new entry there plus its own `scanX()` function, not a rewrite of the dispatch logic.
- [x] **Assisted (paste → AI scores)** — every other source: paste a notice's text or a link into the New Opportunity modal, `analyze-tor` extracts and scores it exactly like a full TOR upload.
- [x] **Monitored-source registry** (`docs/admin/sources.html`) — the ~20 sources from the original spec, each tagged with its actual access method (`api`/`rss`/`email_digest`/`manual_paste`) as found during the pilot, editable as more sources get wired in or re-tested. **ReliefWeb was corrected from `api` to `manual_paste`** (migration 0012) after testing its actual API surface: its only content types (situation reports, individual job vacancies, training, disaster records) don't include procurement/tender notices at all, so there was nothing for `scan-opportunities` to automate regardless of appname approval — leaving it tagged `api` would have implied an adapter was coming that never should.
- [x] Hybrid scoring — Claude returns raw sub-scores + two flags (`has_blocking_eligibility_issue`, `source_fully_read`); the cap rules (blocking eligibility → capped at 49; partial source read → capped at 84, flagged "À CONFIRMER") are applied deterministically in code, not left to model arithmetic.
- [x] Scheduled, autonomous scanning — a `pg_cron` job calls `scan-opportunities` with `{ all: true }` once a day (06:00 UTC) across every active API-automatable source, authenticated as a trusted system caller via a Supabase Vault-stored service-role secret (never committed to git). The "Scan Sources" button still works exactly as before for on-demand runs. Every run — manual or scheduled — is logged to `scan_runs` (`supabase/migrations/0011_scheduled_scanning.sql`), visible on `docs/admin/sources.html` under Scan History.

**Before use:** run `supabase/migrations/0008_opportunity_intelligence.sql` in the Supabase SQL Editor and deploy/redeploy `supabase functions deploy analyze-tor scan-opportunities` (`analyze-tor` changed; `scan-opportunities` is new). No new secrets — reuses `ANTHROPIC_API_KEY`.

**Before use (scheduled scanning):** run `supabase/migrations/0011_scheduled_scanning.sql`, then in the SQL Editor run `select vault.create_secret('<your service_role key>', 'service_role_key');` with the real key from Project Settings → API → service_role (never share this key with me), and redeploy `supabase functions deploy scan-opportunities` (it changed to recognize the service-role key as a trusted caller and to log every run).

**Before use (TED adapter + ReliefWeb correction):** run `supabase/migrations/0012_ted_adapter.sql` and redeploy `supabase functions deploy scan-opportunities`. No new secrets — TED's API needs no key at all.

## Bid/No-Bid Analysis

A holistic go/no-go recommendation, distinct from `strategic_score` (which only scores the opportunity's own attributes at intake time). This factors in the actual matched candidate pool (`opportunity_expert_matches`) and the team assembled so far (`opportunity_selected_experts`), plus days remaining before the deadline, to recommend GO / CONDITIONAL_GO / NO_GO with an estimated success chance, strengths, and risks. Runs on demand from the Opportunity Overview tab; overwrites the previous snapshot each time (no history table, same pattern as `strategic_score_breakdown`). See `supabase/migrations/0009_bid_no_bid_analysis.sql` and `supabase/functions/bid-no-bid-analysis`.

**Before use:** run `supabase/migrations/0009_bid_no_bid_analysis.sql` and deploy `supabase functions deploy bid-no-bid-analysis`. No new secrets.

## Module 7 — Proposal Knowledge Base

A central library of past proposals, winning methodologies, project references, donor-requirement notes, and templates (`docs/admin/knowledge-base.html`), organized into the six categories from the original platform proposal: Methodologies, Technical Proposals, CVs, References, Donor Requirements, Templates. Uploaded documents (PDF/DOCX/TXT) get an AI-extracted content digest via `analyze-kb-document` — exact text for DOCX/TXT, a condensed (not verbatim) summary for PDFs, since long PDFs risk being paraphrased rather than transcribed.

`generate-proposal-doc`'s EOI and Technical Approach prompts now pull the 2 most relevant knowledge-base documents (matching the opportunity's sector/donor when tagged, falling back to most recent) as style/precedent reference — this is deliberately a simple filtered-retrieval MVP, not semantic/vector search (no pgvector in this stack), under the same "reference for tone only, don't copy facts" guardrail as the rest of the document generator.

**Before use:** run `supabase/migrations/0010_knowledge_base.sql` and deploy `supabase functions deploy analyze-kb-document generate-proposal-doc` (the latter changed to add retrieval). No new secrets.

### Structured Lessons-Learned Database

A purpose-built post-mortem log (`docs/admin/lessons-learned.html`), distinct from the document library above — each entry is a short structured record rather than a file: a title, a type (**Success** — a practice worth repeating, or **Challenge** — a mistake or risk to avoid), a category (proposal process, technical delivery, financial/budget, client/donor relations, team/staffing, logistics/operations, compliance/eligibility), what happened, and a recommendation, optionally linked to the opportunity it came from and tagged by sector/donor.

This closes the loop the feature is named for: `generate-proposal-doc`'s Technical Approach and Workplan prompts now also pull the top 3 most relevant **Challenge** entries (same sector/donor-priority retrieval style as the knowledge base above) and inject them as risk-avoidance guidance — "here's what went wrong on a similar past assignment, don't repeat it" — rather than leaving that knowledge to depend on whoever happens to remember it. Only Challenge entries are surfaced this way; a documented Success doesn't need to steer a draft the same way a documented mistake does.

**Before use:** run `supabase/migrations/0013_lessons_learned.sql` and redeploy `supabase functions deploy generate-proposal-doc` (changed to add retrieval). No new secrets.

## Ask ACSD Intelligence

Natural-language search over the expert roster (`docs/admin/ask.html`), the last named idea from the original proposal's "Fonctionnalités IA Avancées" section. Claude only interprets the free-text question into structured criteria (sectors/geographies/languages/donors/seniority/an opportunity reference) — it never sees or names actual experts, so it can't hallucinate a match. Retrieval and scoring are deterministic: if the question resolves to an open opportunity, results reuse whatever match scores `compute-matches` already computed for it; otherwise a transparent relevance-count filter ranks experts against the extracted criteria. No second AI pass composes the answer — the UI renders real query results directly.

**Before use:** deploy `supabase functions deploy ask-acsd-intelligence`. No new schema, no new secrets.

## Reporting

`docs/reports.html` (already covering Expert Roster / User Directory / Audit Log) now has four more filterable, exportable (PDF/Excel/CSV/Word/Print) tabs covering every module built this session:

- **Opportunities** — pipeline view: status, type, source, sectors, strategic score + confidence, Bid/No-Bid recommendation and success chance, deadline.
- **Team & Financials** (admin-only, like User Directory/Audit Log — carries day-rate data) — cross-opportunity team assignments with days/rate/total.
- **Proposal Documents** — generation/review-status tracker across all opportunities (draft/reviewed/final, AI-generated flag).
- **Knowledge Base** — document inventory by category/sector/donor.

Same export pipeline as the existing tabs (jsPDF/autoTable, XLSX, CSV, html-docx-js), same saved-configuration and audit-logging behavior. Pure frontend change — no new migration, no new Edge Function, nothing to redeploy beyond pushing the updated `docs/reports.html`.

## Multi-Language Support (EN/FR)

A single shared module, `docs/js/i18n.js`, replaces what used to be two separate, inconsistent bilingual implementations (`docs/login.html`'s own inline string table, `docs/js/app.js`'s own copy) with one `STRINGS`/`t()`/`applyI18n()`/`setLang()` system every page loads. The language choice now persists via `localStorage` (`acsd_lang`), so it carries across navigation instead of silently resetting to English on every page load — the gap the two old systems both had.

- [x] **Fully bilingual today**: the auth flow (`login.html`, `reset-password.html`, `update-password.html`), the public roster (`index.html`, including seniority/affiliation badges that were previously hardcoded English regardless of language), and the admin shell — navigation labels, group headings, "Sign out", "← Back to Roster" — injected consistently across all 10 `docs/admin/*.html` pages by `initAdmin()` rather than requiring each page to carry its own toggle markup.
- [ ] **Chrome only, content still English**: `docs/reports.html` (header/toggle wired, the report tabs/filters/tables themselves are not) and the 10 admin CRUD pages' own form labels, table headers, and toast messages — each page's shared header/nav is bilingual, but content specific to that page (e.g. the Experts form, the Opportunities table) is not yet. Expanding into these is the natural next increment: tag the existing markup with `data-i18n`, add the keys to `I18N_STRINGS`, no architecture changes needed.

Any page/script can add new strings by adding a key to both `en`/`fr` blocks in `I18N_STRINGS` and either tagging markup with `data-i18n`/`data-i18n-placeholder`/`data-i18n-title`, or calling `t('key')` directly in generated HTML. A `data-lang-variant="light"` wrapper is available for toggles that sit on a white background (the auth pages) rather than the navy header bar.

**Before use:** push `docs/js/i18n.js` and the updated pages — pure frontend change, no migration, no Edge Function, nothing to redeploy.

## Mobile Access

Verified, not assumed: a live width/layout audit found the admin shell's sidebar was a fixed `w-48` column with no responsive treatment at all — genuinely broken on a phone, not just untested — despite the platform already describing itself as "fully responsive" elsewhere. This closes that gap rather than leaving the claim uncorrected.

- [x] **Admin shell** — the sidebar nav is now a slide-over drawer below the `md` breakpoint, opened by a hamburger button in the header and closed via backdrop tap, the "×" button, or Escape. Above `md` it renders exactly as the original static column (`docs/css/style.css`'s `.admin-sidebar`/`.mobile-nav-toggle`/`.admin-sidebar-backdrop` rules, wired by `docs/js/admin.js`'s `toggleMobileNav()`/`closeMobileNav()`). Applied identically across all 11 admin pages.
- [x] **Public roster** (`index.html`) — the filters sidebar is a native `<details>` disclosure: collapsible on mobile (tap "Filters" to expand/collapse, chevron rotates), and inert/always-open on desktop so nothing changes there. The body layout stacks to a single column below `md` instead of squeezing a fixed-width sidebar next to the card grid.
- [x] **Header overflow safety net** — every top-level page's header actions row (`index.html`, `reports.html`, all admin pages) now wraps onto a second line instead of overflowing when badges/links/language toggle/sign-out don't all fit one line — a real, reproducible bug caught by testing at actual mobile widths, not just narrowing a desktop browser window.
- [ ] **Not yet touched**: `reports.html`'s report tabs/filters/tables (dense data tables don't collapse well to mobile without a larger redesign — same honest boundary already drawn for this page in the Multi-Language section above) and the admin pages' own dense content (large forms, wide tables) beyond the shared shell fix.

**A tooling note for future verification work on this repo:** this environment's headless Chrome, invoked as `chrome.exe --headless --window-size=W,H --screenshot=...`, does **not** reliably honor `--window-size` for layout purposes — observed effective widths were inconsistent (e.g. a 390px request rendered at `innerWidth=512`, 600→578, 800→778), which produced several false "this is broken" readings during development before the cause was isolated. `npx playwright`, driving the same Chrome binary via `chromium.launch({ executablePath: ... })` and `browser.newPage({ viewport: { width, height } })`, reports and renders the exact requested width and is the reliable method — use it, not the raw CLI screenshot flag, for any future mobile-width verification here.

**Before use:** push the updated `docs/` files — pure frontend change, no migration, no Edge Function, nothing to redeploy.

## Contract Management

Post-award tracking (`docs/admin/contracts.html`) — the delivery-side counterpart to the bid-side pipeline (Opportunities → Matching → Proposals) already live, closing the gap named in the original roadmap: "delivery-side visibility to match the bid-side visibility already live." Lives in its own **Delivery** nav group, distinct from Opportunities, since it's a genuinely different phase (post-award, not bid).

- [x] **Contracts** — title, client/organization, optional link back to the originating opportunity and donor, value + currency (USD/EUR/GBP/XOF — XOF included since ACSD is Burkina Faso-based and not every contract is dollar-denominated), status (draft/active/completed/terminated), signed/start/end dates, notes, and an optional signed-agreement upload (own `contracts` storage bucket, same admin-write/authenticated-read policy as every other document bucket in this schema).
- [x] **Milestones** — deliverables and/or payment obligations per contract, since not every obligation carries a payment (a quarterly compliance report has a due date and no amount; a deliverable usually has both). Linear status lifecycle (not started → delivered → invoiced → paid). "Overdue" is deliberately **not** a stored status — it's derived in the UI from `due_date < today AND status not in (delivered, invoiced, paid)`, so it can never go stale the way a stored flag could, consistent with how `strategic_score` caps and other derived values are handled elsewhere in this schema.
- [x] **Summary strip** — total contracts, contract value, paid-to-date, and outstanding-invoiced, broken out **per currency** rather than naively summed across currencies (a real correctness bug avoided, not just a nice-to-have, given USD/EUR/XOF contracts can coexist).

**Before use:** run `supabase/migrations/0014_contract_management.sql` in the Supabase SQL Editor. No Edge Function, no new secrets — pure schema + frontend.

## Task Management & Calendar Integration

Assignment and deadline tracking (`docs/admin/tasks.html`), optionally linked to the opportunity **or** contract the work came from — cross-cutting, so it sits ungrouped in the nav next to Dashboard rather than inside Opportunities or Delivery, since a task can be either ("finish TOR analysis by Friday" is bid-side; "submit Q1 progress report" is delivery-side).

- [x] **Tasks** — title, description, assignee (from `profiles`), optional opportunity/contract link, due date, priority (low/medium/high), status (open/in progress/done). "Overdue" is derived in the UI from `due_date`, same convention as contract milestones — never a stored flag that could go stale.
- [x] **Calendar Integration — real, not simulated.** Every task with a due date is available as a live iCalendar (`.ics`) subscription feed (`supabase/functions/calendar-feed`) that Google Calendar, Outlook, and Apple Calendar can all subscribe to natively — no plugin, no OAuth app. Each user gets their own feed URL secured by an unguessable per-user token (`profiles.calendar_token`, added by this migration), the same "capability URL" pattern comparable calendar-feed features use elsewhere (Trello, Asana, GitHub) — not the standard Bearer-JWT check every other function in this project uses, because calendar apps fetch subscribed URLs anonymously on a timer, with no login step to complete. A one-off **Add to Calendar** button per task also downloads a single-event `.ics` file client-side for anyone who just wants one deadline, not a live subscription.
- [ ] **Deliberately not built**: two-way Google/Outlook OAuth sync (editing a task from inside your calendar app and having it write back here). That would require registering and getting approval for an OAuth app in each vendor's developer console — an external dependency this migration can't complete on its own, the same category of constraint that shaped the ReliefWeb decision in Module 1. The `.ics` feed is one-way (read-only in the calendar app) by design, not as a placeholder for something more that's still coming.

**Before use:** run `supabase/migrations/0015_task_management.sql` in the Supabase SQL Editor, then deploy the feed function **with JWT verification disabled** — this is not optional, the feed will 401 on every request otherwise, since calendar apps never send a Supabase auth token:
```
supabase functions deploy calendar-feed --no-verify-jwt
```

## Meeting Management / AI Secretary

Scheduling and structured minutes (`docs/admin/meetings.html`), optionally linked to the opportunity or contract they relate to — same cross-cutting nav placement as Tasks, since a meeting can be bid-side (a donor clarification call) or delivery-side (a client progress review).

- [x] **Meetings** — title, description, start/end time, location (address or a video-call link), status (scheduled/completed/cancelled), internal attendees (checked against `profiles`, so their own calendar feed picks the meeting up automatically) plus a free-text field for external attendees (donor/client contacts who aren't platform users).
- [x] **AI Secretary — real extraction, not live transcription.** An admin pastes their own raw notes or a rough transcript taken during/after the meeting; `analyze-meeting-notes` structures it into a summary, a list of decisions, and a list of action items (each with an AI-guessed assignee name, since the AI can only read a name off the page — it can't reliably resolve that name to a real `profiles` account). Everything is editable before saving — the AI drafts, a human reviews, same guardrail as every other AI-assisted feature in this platform.
- [x] **Action items → real tasks.** Any saved action item can become an actual row in `tasks` with one click (inheriting the meeting's linked opportunity/contract), so it's tracked with a real assignee, due date, and status instead of living as a second, disconnected to-do list. Once converted, it shows as a linked, read-only "task created" entry rather than a duplicate editable line.
- [x] **Calendar Integration extended, not duplicated.** `calendar-feed` (built for Task Management) now also includes each attendee's scheduled meetings as real timed events (not all-day, like task due dates) alongside their tasks in the same personal `.ics` subscription feed — no second feed URL to distribute.
- [ ] **Deliberately not built**: live audio capture or speech-to-text transcription (would need a bot joining the call or a dedicated transcription pipeline — a real external dependency, not something buildable inside this migration) and auto-sent calendar invites to external attendees (would need to actually email people on ACSD's behalf, a much bigger trust/deliverability commitment than this feature set has taken on so far). The AI Secretary is deliberately "structure what a human already wrote," not "listen and decide what happened."

**Before use:** run `supabase/migrations/0016_meeting_management.sql` in the Supabase SQL Editor and deploy `supabase functions deploy analyze-meeting-notes calendar-feed` — `calendar-feed` changed (to add meetings) and **must keep JWT verification disabled**:
```
supabase functions deploy analyze-meeting-notes
supabase functions deploy calendar-feed --no-verify-jwt
```
No new secrets — `analyze-meeting-notes` reuses `ANTHROPIC_API_KEY`.

## Collaboration Workspace

In-context comment/review threads (`docs/js/comments.js`, a shared module — not a new page), replacing the email-and-file-name version control the original roadmap entry named as the gap to close.

- [x] **Threads attach to any record** via a polymorphic `(entity_type, entity_id)` pair — the same "point at whatever record this was about" convention `audit_logs` already uses, rather than a one-off join table per entity type. Comments support one level of replies (a comment can be replied to, a reply can't be replied to again), resolve/reopen, and delete — the reviewer-thread vocabulary this feature is named for.
- [x] **Wired into the two places the roadmap named** — "live opportunities and drafts": a general **Discussion** tab on `opportunity-detail.html` (`entity_type='opportunity'`), and a per-document **Comments** button on every generated proposal document card — EOI, Technical Approach, Workplan, each tailored CV (`entity_type='proposal_document'`), so review feedback on one specific draft doesn't get mixed into the opportunity's general discussion.
- [x] Author names resolve the same way `tasks.html` already resolves `assigned_to` — a separately-fetched `profiles` list matched by id in JS, not a PostgREST embed, since `comments.author_id` references `auth.users(id)` and PostgREST can't auto-join across that boundary to `profiles`.
- [ ] **Deliberately not built**: @mention notifications (would depend on the still-unbuilt Notifications roadmap item — this feature marks who wrote a comment, it doesn't page anyone), and nested (multi-level) reply threads — one level keeps a review thread readable without the UI complexity a full comment tree needs, and covers the actual use case (a reply, and replies-to-the-reply are just further replies on the same thread).

**Before use:** run `supabase/migrations/0017_collaboration_workspace.sql` in the Supabase SQL Editor and push the updated `docs/` files. No Edge Function, no new secrets — pure schema + frontend, same as Contract Management.

## Notifications

A bell icon in the admin shell (every page, via `initAdmin()` — no per-page markup needed) plus an optional daily email digest, closing the roadmap gap: "nothing time-sensitive should depend on someone remembering to log in."

- [x] **In-app notifications — real, no external dependency.** `notifications` is the first table in this schema with per-user (not per-role) RLS: `auth.uid() = user_id`, so even an admin can't browse anyone else's feed the way they can browse everyone else's tasks or contracts. Three sources feed it:
  - `compute-matches` notifies the admin who ran it when a new match scores ≥80.
  - `scan-opportunities` notifies the triggering admin (manual run) or every admin (scheduled run) when a scan finds new opportunities.
  - `send-notification-digest` (new Edge Function, scheduled daily at 07:00 UTC via the same pg_cron + Vault pattern as the opportunity scan) checks for tasks due soon, meetings starting soon, contract milestones due soon, and opportunity deadlines approaching, and notifies the relevant assignee or — for milestones/deadlines, which have no single owner — every admin.
  - Every insert goes through a `(user_id, dedupe_key)` unique index with `ON CONFLICT DO NOTHING`, so a rerun of the daily check never re-notifies about the same still-pending deadline, but a due date that actually changes gets a fresh notification.
- [x] **Bell dropdown** (`docs/js/admin.js`) — unread badge, last 20 notifications, click-to-navigate (marks read and opens the linked page), Mark All Read. Reload-based, not push/real-time, consistent with the rest of this app (no websocket/Realtime subscriptions used anywhere else in this schema).
- [x] **Email digest — real, but bring-your-own-key.** `send-notification-digest` also emails anyone with unsent notifications, once per item (a `notified_via_email` flag prevents re-emailing the same notification every day), via Resend's HTTP API. This only activates once a `RESEND_API_KEY` secret is set — Resend has a free tier with no credit card, unlike the paid procurement APIs left unbuilt in Module 1. Without the key, this function still runs and still generates in-app notifications; it just logs that the email step was skipped rather than failing or faking it.
- [ ] **Deliberately not built**: push notifications (mobile push needs a registered app in Apple/Google's push services — the same category of external-dependency constraint as Task Management's OAuth calendar sync) and SMS. Email digest recipients beyond the Resend account's own address also require a verified sending domain in Resend's dashboard — a one-time setup step outside what any migration can do.

**Before use:** run `supabase/migrations/0018_notifications.sql` in the Supabase SQL Editor and deploy the three touched/new functions:
```
supabase functions deploy compute-matches scan-opportunities send-notification-digest
```
The scheduled digest reuses the `service_role_key` Vault secret already created for scan-opportunities-daily (migration 0011) — nothing new to configure there. To enable the optional email step:
```
supabase secrets set RESEND_API_KEY=<your resend api key>
```
