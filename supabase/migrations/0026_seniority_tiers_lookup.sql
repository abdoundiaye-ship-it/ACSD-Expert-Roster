-- Converts seniority_tier from a hardcoded CHECK constraint into a real
-- lookup table, following the same shape as sectors/languages/etc. The FK
-- targets seniority_tiers(code) rather than its smallserial id, so every
-- existing string comparison across the frontend and edge functions
-- ('junior', 'intermediary', 'senior', 'principal_expert') keeps working
-- unchanged — only the *set of valid values* becomes admin-manageable
-- instead of hardcoded, and delete is blocked by the FK itself (same
-- protection pattern as every other Reference Data table) if a tier is
-- still in use on any expert or opportunity position.
begin;

create table seniority_tiers (
  id smallserial primary key,
  code text not null unique,       -- stable key used throughout app code — do not rename after creation
  name text not null,              -- display label (fallback when no i18n translation exists for this code)
  sort_order smallint not null unique
);

insert into seniority_tiers (code, name, sort_order) values
  ('junior', 'Junior', 1),
  ('intermediary', 'Intermediary', 2),
  ('senior', 'Senior', 3),
  ('principal_expert', 'Principal Expert', 4);

alter table seniority_tiers enable row level security;
create policy "authenticated read seniority_tiers" on seniority_tiers for select to authenticated using (true);
create policy "admin write seniority_tiers" on seniority_tiers for all to authenticated using (is_admin()) with check (is_admin());

alter table experts drop constraint experts_seniority_tier_check;
alter table experts add constraint experts_seniority_tier_fkey foreign key (seniority_tier) references seniority_tiers (code);

alter table opportunity_positions drop constraint opportunity_positions_required_seniority_tier_check;
alter table opportunity_positions add constraint opportunity_positions_required_seniority_tier_fkey foreign key (required_seniority_tier) references seniority_tiers (code);

commit;
