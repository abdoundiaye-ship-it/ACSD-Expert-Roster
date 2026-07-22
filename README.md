# ACSD Expert Roster Management System

A searchable, manageable database of experts for ACSD's response to RFP DDP-SEN-DKR-2026-05
(Framework Agreement for Technical Support Services — Pool of Experts, SRF FMU, DRC).

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

**Before use:** run `supabase/migrations/0006_opportunities_module.sql` in the Supabase SQL Editor and deploy the three new Edge Functions (`supabase functions deploy analyze-tor compute-matches generate-proposal-doc`) — they reuse the same `ANTHROPIC_API_KEY` secret already configured for `analyze-cv`.
