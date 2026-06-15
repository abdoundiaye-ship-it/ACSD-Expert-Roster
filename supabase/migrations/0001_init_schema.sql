-- ACSD Expert Roster Management System
-- Initial schema: lookup/controlled-vocabulary tables, core expert tables,
-- many-to-many tagging tables, auth roles, RLS policies, and CV storage bucket.
--
-- Controlled vocabulary sourced from:
--   - Annex F (TOR) section 4 / section 12 criteria #2: 23 priority sectors
--   - Annex F (TOR) section 6: work-order/assignment types
--   - Annex F (TOR) criteria #3: deliverable/activity types
--   - Annex F (TOR) criteria #4 + Financial Proposal sheet 1: seniority tiers
--   - Original brief: donor categories (humanitarian / development / private & foundations)

-- =========================================================================
-- Extensions
-- =========================================================================
create extension if not exists pgcrypto;

-- =========================================================================
-- Helper: updated_at trigger function
-- =========================================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- Auth roles
-- =========================================================================
create table user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'viewer')) default 'viewer',
  created_at timestamptz not null default now()
);

create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- =========================================================================
-- Lookup / controlled-vocabulary tables
-- =========================================================================

-- Priority sectors (TOR section 4 / criteria #2 — 23 items)
create table sectors (
  id smallserial primary key,
  name text not null unique,
  sort_order smallint not null
);

insert into sectors (name, sort_order) values
  ('Health', 1),
  ('Food security', 2),
  ('Nutrition', 3),
  ('Economic recovery and livelihoods', 4),
  ('Protection', 5),
  ('Shelter and settlements', 6),
  ('WASH', 7),
  ('Education in emergencies', 8),
  ('Conflict sensitivity', 9),
  ('Access and safety', 10),
  ('Migration and displacement', 11),
  ('Humanitarian disarmament', 12),
  ('Peacebuilding', 13),
  ('Climate adaptation and resilience programming', 14),
  ('Area-based approaches', 15),
  ('Cash and voucher assistance', 16),
  ('Accountability to affected populations', 17),
  ('Gender equality and social inclusion', 18),
  ('MEAL technical integration', 19),
  ('Localisation approaches', 20),
  ('Core Humanitarian Standards', 21),
  ('Finance', 22),
  ('Human Resources', 23);

-- Languages (seed with French/English per TOR eligibility + common regional languages;
-- extensible — admins can add more found in CVs)
create table languages (
  id smallserial primary key,
  name text not null unique
);

insert into languages (name) values
  ('French'),
  ('English'),
  ('Wolof'),
  ('Bambara'),
  ('Moore'),
  ('Fulfulde'),
  ('Dioula'),
  ('Hausa'),
  ('Arabic'),
  ('Portuguese'),
  ('Lingala'),
  ('Sango');

-- Geographies (West & Central Africa focus per TOR; extensible lookup, not a closed enum)
create table geographies (
  id smallserial primary key,
  country_name text not null unique,
  region text
);

insert into geographies (country_name, region) values
  ('Senegal', 'West Africa'),
  ('Mali', 'West Africa / Sahel'),
  ('Burkina Faso', 'West Africa / Sahel'),
  ('Niger', 'West Africa / Sahel'),
  ('Chad', 'Central Africa / Sahel'),
  ('Mauritania', 'West Africa / Sahel'),
  ('Nigeria', 'West Africa'),
  ('Cameroon', 'Central Africa'),
  ('Cote d''Ivoire', 'West Africa'),
  ('Togo', 'West Africa'),
  ('Benin', 'West Africa'),
  ('Ghana', 'West Africa'),
  ('Guinea', 'West Africa'),
  ('Guinea-Bissau', 'West Africa'),
  ('Liberia', 'West Africa'),
  ('Sierra Leone', 'West Africa'),
  ('Gambia', 'West Africa'),
  ('Democratic Republic of the Congo', 'Central Africa'),
  ('Central African Republic', 'Central Africa'),
  ('Republic of the Congo', 'Central Africa'),
  ('Gabon', 'Central Africa');

-- Donor categories (humanitarian / development / private sector & foundations)
create table donor_categories (
  id smallserial primary key,
  name text not null unique
);

insert into donor_categories (name) values
  ('Humanitarian'),
  ('Development'),
  ('Private Sector & Foundations');

-- Donors (seed with commonly referenced donors; extensible)
create table donors (
  id smallserial primary key,
  name text not null unique,
  category_id smallint not null references donor_categories (id)
);

insert into donors (name, category_id) values
  ('ECHO', 1), ('OCHA', 1), ('UNHCR', 1), ('UNICEF', 1), ('WFP', 1),
  ('USAID', 2), ('World Bank', 2), ('EU', 2), ('FCDO', 2), ('AFD', 2), ('GIZ', 2), ('DANIDA', 2),
  ('Gates Foundation', 3), ('Mastercard Foundation', 3);

-- Deliverable / activity-experience types (TOR criteria #3 — 11 items)
create table activity_types (
  id smallserial primary key,
  name text not null unique
);

insert into activity_types (name) values
  ('Technical review reports'),
  ('Scoring sheets for concept notes or proposals'),
  ('Narrative technical assessments'),
  ('Field monitoring reports'),
  ('Evaluation reports'),
  ('Training materials'),
  ('Technical guidance notes'),
  ('Methodological frameworks'),
  ('Recommendations for programme improvement'),
  ('Workshop facilitation outputs'),
  ('Presentation materials');

-- Work-order / assignment role types (TOR section 6 + Financial Proposal sheet 2)
create table work_order_roles (
  id smallserial primary key,
  name text not null unique,
  indicative_days text
);

insert into work_order_roles (name, indicative_days) values
  ('Concept-note review', '15 days'),
  ('Full-proposal review', '15 days'),
  ('Field technical monitoring', '5-15 days'),
  ('Sectoral evaluation - Team Leader', '20-40 days'),
  ('Sectoral evaluation - Senior evaluator', '20-40 days'),
  ('Capacity-strengthening assignment', '5-20 days');

-- =========================================================================
-- Core table: experts
-- =========================================================================
create table experts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  title text,
  affiliation_type text not null check (affiliation_type in ('internal', 'partner')),
  partner_org text,
  seniority_tier text check (seniority_tier in ('junior', 'intermediary', 'senior', 'principal_expert')),
  years_experience numeric(4,1),
  availability_status text not null default 'unknown'
    check (availability_status in ('available', 'assigned', 'unavailable', 'unknown')),
  availability_notes text,
  bio_summary text,
  cv_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_org_requires_partner_affiliation
    check (affiliation_type = 'partner' or partner_org is null)
);

create trigger experts_set_updated_at
  before update on experts
  for each row execute function set_updated_at();

create index experts_seniority_idx on experts (seniority_tier);
create index experts_affiliation_idx on experts (affiliation_type);
create index experts_availability_idx on experts (availability_status);

-- =========================================================================
-- Many-to-many tagging tables
-- =========================================================================

-- Sector tags, with one primary sector per expert and any number of secondary sectors
create table expert_sectors (
  expert_id uuid not null references experts (id) on delete cascade,
  sector_id smallint not null references sectors (id),
  priority text not null check (priority in ('primary', 'secondary')),
  primary key (expert_id, sector_id)
);

create unique index one_primary_sector_per_expert
  on expert_sectors (expert_id)
  where priority = 'primary';

-- Languages spoken
create table expert_languages (
  expert_id uuid not null references experts (id) on delete cascade,
  language_id smallint not null references languages (id),
  proficiency text check (proficiency in ('native', 'fluent', 'professional', 'working')),
  primary key (expert_id, language_id)
);

-- Geographic experience
create table expert_geographies (
  expert_id uuid not null references experts (id) on delete cascade,
  geography_id smallint not null references geographies (id),
  primary key (expert_id, geography_id)
);

-- Donor experience, with free-text notes for project/context
create table expert_donor_experience (
  expert_id uuid not null references experts (id) on delete cascade,
  donor_id smallint not null references donors (id),
  notes text,
  primary key (expert_id, donor_id)
);

-- Education & certifications
create table education_certifications (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references experts (id) on delete cascade,
  type text not null check (type in ('education', 'certification')),
  title text not null,
  institution text,
  year smallint
);

create index education_certifications_expert_idx on education_certifications (expert_id);

-- Demonstrated activity/deliverable experience
create table expert_activity_experience (
  expert_id uuid not null references experts (id) on delete cascade,
  activity_type_id smallint not null references activity_types (id),
  evidence_notes text,
  primary key (expert_id, activity_type_id)
);

-- Fit against work-order role types (cross-referenced from the Technical Proposal)
create table expert_role_fit (
  expert_id uuid not null references experts (id) on delete cascade,
  work_order_role_id smallint not null references work_order_roles (id),
  notes text,
  primary key (expert_id, work_order_role_id)
);

-- =========================================================================
-- Row Level Security
-- =========================================================================

-- user_roles
alter table user_roles enable row level security;

create policy "users read own role"
  on user_roles for select
  to authenticated
  using (user_id = auth.uid());

create policy "admin manage roles"
  on user_roles for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- Reference/lookup tables: any authenticated user can read; only admins can modify
create policy "authenticated read sectors" on sectors for select to authenticated using (true);
create policy "admin write sectors" on sectors for all to authenticated using (is_admin()) with check (is_admin());
alter table sectors enable row level security;

create policy "authenticated read languages" on languages for select to authenticated using (true);
create policy "admin write languages" on languages for all to authenticated using (is_admin()) with check (is_admin());
alter table languages enable row level security;

create policy "authenticated read geographies" on geographies for select to authenticated using (true);
create policy "admin write geographies" on geographies for all to authenticated using (is_admin()) with check (is_admin());
alter table geographies enable row level security;

create policy "authenticated read donor_categories" on donor_categories for select to authenticated using (true);
create policy "admin write donor_categories" on donor_categories for all to authenticated using (is_admin()) with check (is_admin());
alter table donor_categories enable row level security;

create policy "authenticated read donors" on donors for select to authenticated using (true);
create policy "admin write donors" on donors for all to authenticated using (is_admin()) with check (is_admin());
alter table donors enable row level security;

create policy "authenticated read activity_types" on activity_types for select to authenticated using (true);
create policy "admin write activity_types" on activity_types for all to authenticated using (is_admin()) with check (is_admin());
alter table activity_types enable row level security;

create policy "authenticated read work_order_roles" on work_order_roles for select to authenticated using (true);
create policy "admin write work_order_roles" on work_order_roles for all to authenticated using (is_admin()) with check (is_admin());
alter table work_order_roles enable row level security;

-- Core/roster tables: any authenticated user can read (search/filter/export);
-- only admins can add, update, or remove experts
create policy "authenticated read experts" on experts for select to authenticated using (true);
create policy "admin write experts" on experts for all to authenticated using (is_admin()) with check (is_admin());
alter table experts enable row level security;

create policy "authenticated read expert_sectors" on expert_sectors for select to authenticated using (true);
create policy "admin write expert_sectors" on expert_sectors for all to authenticated using (is_admin()) with check (is_admin());
alter table expert_sectors enable row level security;

create policy "authenticated read expert_languages" on expert_languages for select to authenticated using (true);
create policy "admin write expert_languages" on expert_languages for all to authenticated using (is_admin()) with check (is_admin());
alter table expert_languages enable row level security;

create policy "authenticated read expert_geographies" on expert_geographies for select to authenticated using (true);
create policy "admin write expert_geographies" on expert_geographies for all to authenticated using (is_admin()) with check (is_admin());
alter table expert_geographies enable row level security;

create policy "authenticated read expert_donor_experience" on expert_donor_experience for select to authenticated using (true);
create policy "admin write expert_donor_experience" on expert_donor_experience for all to authenticated using (is_admin()) with check (is_admin());
alter table expert_donor_experience enable row level security;

create policy "authenticated read education_certifications" on education_certifications for select to authenticated using (true);
create policy "admin write education_certifications" on education_certifications for all to authenticated using (is_admin()) with check (is_admin());
alter table education_certifications enable row level security;

create policy "authenticated read expert_activity_experience" on expert_activity_experience for select to authenticated using (true);
create policy "admin write expert_activity_experience" on expert_activity_experience for all to authenticated using (is_admin()) with check (is_admin());
alter table expert_activity_experience enable row level security;

create policy "authenticated read expert_role_fit" on expert_role_fit for select to authenticated using (true);
create policy "admin write expert_role_fit" on expert_role_fit for all to authenticated using (is_admin()) with check (is_admin());
alter table expert_role_fit enable row level security;

-- =========================================================================
-- CV storage bucket
-- =========================================================================

insert into storage.buckets (id, name, public)
values ('expert-cvs', 'expert-cvs', false)
on conflict (id) do nothing;

-- Default: CV files are admin-only (download access). Revisit if viewers
-- should also be able to fetch signed URLs for CVs.
create policy "admin manage cv files"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'expert-cvs' and is_admin())
  with check (bucket_id = 'expert-cvs' and is_admin());
