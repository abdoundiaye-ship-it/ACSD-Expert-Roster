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
