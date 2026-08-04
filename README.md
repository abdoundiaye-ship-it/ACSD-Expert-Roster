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

- [x] **Fully bilingual**: the auth flow (`login.html`, `reset-password.html`, `update-password.html`), the public roster (`index.html`, including seniority/affiliation badges), the admin shell (navigation labels, group headings, "Sign out", "← Back to Roster" — injected consistently across all 17 `docs/admin/*.html` pages by `initAdmin()`), and every admin CRUD page's own content — form labels, table headers, buttons, empty states, and toast messages, not just the shared chrome around them. `docs/reports.html`'s full UI (tabs, every filter field/option across all 7 report types, actions, saved-configuration panel) is bilingual too. Roughly 700 EN/FR string pairs across `I18N_STRINGS`.
- Static text uses `data-i18n`/`data-i18n-placeholder`/`data-i18n-title` (auto-applied by `applyI18n()` on load and on every language switch); JS-rendered content (table rows, dynamic labels, toasts) calls `t('key')` directly and each page wires a `document.addEventListener('acsd:langchange', ...)` listener that re-runs its render/filter function so switching language updates already-loaded data in place, not just newly-rendered markup.
- [ ] **Deliberately out of scope — generated document/report content**: text that becomes part of an exported deliverable is not retranslated by the admin's personal UI language toggle, since that would be an unintended functional change to a donor-facing document rather than a translation of app chrome. This covers the AI-generated proposal document bodies (EOI/Technical Approach/Workplan/budget tables, `opportunity-detail.html`), the combined-report cover page/TOC/summary, the French-only scoring rubric labels (`SCORE_LABELS`), and — the largest instance — `reports.html`'s actual report output: report titles, stat labels, on-screen table columns, exported CSV/Excel/PDF/Word column headers and formatters, and filter-pill text. All of `reports.html`'s *filter UI* (labels, dropdown options, buttons) is bilingual; the *generated report* it produces is not, by the same reasoning as the proposal documents.

Any page/script can add new strings by adding a key to both `en`/`fr` blocks in `I18N_STRINGS` and either tagging markup with `data-i18n`/`data-i18n-placeholder`/`data-i18n-title`, or calling `t('key')` directly in generated HTML. A `data-lang-variant="light"` wrapper is available for toggles that sit on a white background (the auth pages) rather than the navy header bar.

**Before use:** push `docs/js/i18n.js` and the updated pages — pure frontend change, no migration, no Edge Function, nothing to redeploy.

## Mobile Access

Verified, not assumed: a live width/layout audit found the admin shell's sidebar was a fixed `w-48` column with no responsive treatment at all — genuinely broken on a phone, not just untested — despite the platform already describing itself as "fully responsive" elsewhere. This closes that gap rather than leaving the claim uncorrected.

- [x] **Admin shell** — the sidebar nav is now a slide-over drawer below the `md` breakpoint, opened by a hamburger button in the header and closed via backdrop tap, the "×" button, or Escape. Above `md` it renders exactly as the original static column (`docs/css/style.css`'s `.admin-sidebar`/`.mobile-nav-toggle`/`.admin-sidebar-backdrop` rules, wired by `docs/js/admin.js`'s `toggleMobileNav()`/`closeMobileNav()`). Applied identically across all 11 admin pages.
- [x] **Public roster** (`index.html`) — the filters sidebar is a native `<details>` disclosure: collapsible on mobile (tap "Filters" to expand/collapse, chevron rotates), and inert/always-open on desktop so nothing changes there. The body layout stacks to a single column below `md` instead of squeezing a fixed-width sidebar next to the card grid.
- [x] **Header overflow safety net** — every top-level page's header actions row (`index.html`, `reports.html`, all admin pages) now wraps onto a second line instead of overflowing when badges/links/language toggle/sign-out don't all fit one line — a real, reproducible bug caught by testing at actual mobile widths, not just narrowing a desktop browser window.
- [x] **Every admin form now collapses to one column on mobile.** A follow-up audit (`grep`-scanned every `grid-cols-[234]` across all 17 admin pages) found 32 modal-form field grids that were still hard-coded to 2 or 3 columns with no responsive prefix — added after the initial rollout, in Contract Management, Task Management, Meeting Management, and Client CRM, which shipped after this feature's first pass. All 32 are now `grid-cols-1 sm:grid-cols-N`, verified with an isolated Playwright check confirming the exact class syntax collapses to 1 column at 390px and expands at 800px. `users.html`'s table also had `overflow-hidden` instead of `overflow-x-auto` — a real bug (content got clipped, not scrollable) — fixed, with its Status/Created columns now hidden below `sm`/`md` like every other admin table already did.
- [x] **`reports.html` header rows now wrap** — the page-heading row (title + Save Configuration) and the filter-actions row lacked the `flex-wrap` safety net every other page already had; both fixed.
- [ ] **Still not attempted**: a mobile-specific redesign of `reports.html`'s dense report tables themselves (many columns of financial/pipeline data — collapsing that into a usable phone layout is a real information-design project, not a CSS tweak) and admin pages' widest tables beyond horizontal scroll. Both already scroll horizontally inside their container rather than breaking the page layout; neither has a purpose-built mobile view.

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

## External API Integrations

Outbound webhooks (`docs/admin/webhooks.html`) — the last item on the original roadmap. "External API Integrations" never named a specific target system the way Module 1's donor-portal adapters each did (World Bank, TED — both pilot-tested against real, named APIs). The honest, generic version of "fits into a client's existing technology stack rather than replacing it" is: ACSD supplies a destination URL from whatever they already use — a Slack incoming webhook, Zapier, Make.com, n8n, or their own internal system — and this platform calls it. No specific third-party account or credential is required to build this, unlike the email digest's Resend dependency; each webhook just needs a URL the admin already controls.

- [x] **Database-level triggers, not Edge Function code.** Most writes in this schema happen directly from the browser via the Supabase client (RLS-protected), not funneled through a custom Edge Function — a Postgres trigger fires regardless of which admin page wrote the row, so dispatch logic doesn't need to be duplicated across every place an opportunity, task, or contract can be created or changed. Delivery reuses `pg_net` (already enabled by migration 0011) the same fire-and-forget way the scheduled cron jobs already call their own Edge Functions.
- [x] **Four real trigger events today** — a deliberately small, meaningful set rather than "every column change on every table": `opportunity.created`, `opportunity.status_changed`, `task.completed`, `contract.status_changed`. Adding a new one later is a new trigger function following the same shape, not an architecture change.
- [x] **HMAC-signed deliveries** — every webhook gets a real, auto-generated signing secret (`pgcrypto`'s `gen_random_bytes`); every delivery carries an `X-Webhook-Signature` header (HMAC-SHA256 over the JSON body) so the receiving system can verify a payload actually came from this platform, not a forged request to a guessed URL. The dispatch function (`notify_webhook`) is `SECURITY DEFINER` and `REVOKE`d from `PUBLIC`, so it's only reachable from the trigger functions that call it — not directly callable via RPC by an ordinary authenticated session.
- [x] **Delivery log** (`webhook_deliveries`, visible per-webhook in the admin UI) — records what was sent and when. `pg_net` is fire-and-forget (the response lands asynchronously in its own internal table), so this is an attempted-delivery log, not a confirmed-receipt log — stated as such in the UI rather than implying a guarantee that doesn't exist.
- [ ] **Deliberately not built**: inbound integrations (this platform receiving webhooks/data from outside systems, e.g. a two-way Zapier sync) and a plugin/app-marketplace model for named third-party services (Salesforce, HubSpot, etc.) — each of those is a real, specific integration project in its own right, the same category of scope boundary as the individual donor-portal adapters in Module 1, not something a generic webhook system can honestly claim to cover.

**Before use:** run `supabase/migrations/0019_external_api_integrations.sql` in the Supabase SQL Editor. No Edge Function, no new secrets — pure schema (triggers + `pg_net`) and frontend.

## Client CRM

Structured client and donor relationship tracking (`docs/admin/clients.html`, `docs/admin/client-detail.html`) — the roadmap's own framing: "relationship history retained across staff turnover," not knowledge sitting in one person's inbox or head.

- [x] **`clients` is distinct from the existing `donors` table**, not a replacement for it. `donors` (migration 0001) stays exactly what it always was — a small, shared lookup of ~14 funding bodies used to tag opportunities/experts. `clients` is the broader relationship record: government ministries, NGO primes, and private clients that were never funding-body donors at all, plus donors themselves when there's a real relationship to track (a `clients` row can optionally cross-reference a matching `donors` row).
- [x] **Contacts and interaction log** (`client_contacts`, `client_interactions`) — named people at the client (with a primary-contact flag) and a running log of calls/emails/meetings/other touchpoints. A logged interaction can optionally point at a real row in `meetings` (if Meeting Management is installed) instead of re-typing what a real meeting record already has.
- [x] **"Beyond individual opportunities," for real** — `opportunities.client_id` and `contracts.client_id` (new, nullable columns — existing rows unaffected) roll every opportunity and contract ever tied to a client up into one Related view on its detail page, so the relationship's full history is visible in one place rather than scattered across however many separate bid and delivery records it spans.
- [x] **Relationship owner** (a `profiles` reference) and a **status** (active/dormant/prospective) — the actual "don't lose this when someone leaves" mechanism: the account has a named internal owner on record, not an assumption about who currently "owns" it in someone's head.
- [x] **Reuses Collaboration Workspace, doesn't duplicate it** — a client's detail page has a Discussion tab powered by the same `docs/js/comments.js` module already built for opportunities and proposal documents (migration 0017 explicitly anticipated adding a new `entity_type` here).
- [ ] **Not built**: automatic contact/interaction capture from email or calendar (would need an inbox/calendar integration — the same category of external-dependency constraint as Task Management's OAuth calendar sync) and a relationship "health score" (would need a defined, defensible scoring rubric the way strategic scoring has one — nothing like that exists for relationship health here, so it isn't faked with an arbitrary number).

**Before use:** run `supabase/migrations/0020_client_crm.sql` in the Supabase SQL Editor and push the updated `docs/` files. No Edge Function, no new secrets — pure schema + frontend.

## Platform Hardening & UX Polish

A pass across the whole platform rather than a new module — closing correctness, accessibility, and security gaps found while the feature set above was being built out, plus a sidebar redesign to keep navigation usable as the nav list grew to match.

- [x] **Edge Function hardening** — shared `_shared/{auth,claude,cors,http}.ts` helpers now back every function instead of each one duplicating its own auth check, CORS headers, and Claude API call. Every Claude call goes through one wrapper with request timeouts and retry-with-backoff, closing the gap where an unbounded or failed AI call — notably the per-notice scoring loop in `scan-opportunities` — could hang or silently fail. Also fixes a JSON-parsing regex bug in two functions, a stale-cache window in `send-notification-digest`, and missing CORS headers on 405 responses in the admin user-management functions.
- [x] **Frontend correctness** — `opportunity-detail.html`'s 13 mutation handlers now patch already-loaded local state and re-render just the affected panel instead of re-running the full 9–10 query detail reload on every save/delete (`loadDetail()` now only runs on initial page load). Double-submit guards added to the 9 save/delete handlers that lacked them (experts, opportunities, opportunity detail); ~15 previously-silent write failures now surface via toast; search input debounced across all 8 admin list pages via a shared helper in `admin.js`.
- [x] **Accessibility pass** — ~114 form labels associated with their inputs across all 17 admin pages, `role="dialog"`/`aria-modal` plus focus management on the shared modal open/close helpers, keyboard-operable drag-and-drop upload zones, and low-contrast label text fixed to meet WCAG AA. Also fixes a real bug found during the label pass: `contracts.html` had two different fields sharing `id="cm-client"` (a free-text org-name input and a CRM client dropdown), so the dropdown was never populated and editing a contract could silently overwrite the org name with a raw client UUID.
- [x] **Security/robustness fixes** — CSV/XLSX export in `reports.html` now neutralizes formula-injection payloads; `contracts.html`'s file upload gets the same client-side type/size validation the other three upload flows already had; `@supabase/supabase-js` is pinned to an exact version instead of a floating major-version tag.
- [x] **Admin sidebar redesign** — an icon per nav item, "+ Expert"/"+ Opportunity" quick-add shortcuts pinned above the nav on every page (linking to `<page>.html?new=1`, which auto-opens the existing Add modal), Reports moved out of its orphaned spot at the bottom into the top cross-cutting tier with Dashboard/Tasks/Meetings, and the Administration group (Users/Roles/Webhooks/Audit) made collapsible and collapsed by default via `localStorage` — config/setup work, not daily workflow, so hiding it shortens the common-case list from 16 items to 12. Active-page highlighting gets a left accent border in addition to the background tint, and the two drill-down pages (`opportunity-detail.html`, `client-detail.html`) get real breadcrumbs ("Opportunities / [Title]", "Clients / [Name]") in place of the old "← Back" links.

**Before use:** push the updated `docs/` files and redeploy every Edge Function to pick up the shared `_shared/` helpers:
```
supabase functions deploy admin-delete-user admin-invite-user analyze-cv analyze-kb-document analyze-meeting-notes analyze-tor ask-acsd-intelligence bid-no-bid-analysis compute-matches generate-proposal-doc scan-opportunities send-notification-digest
```
No new migration, no new secrets.
