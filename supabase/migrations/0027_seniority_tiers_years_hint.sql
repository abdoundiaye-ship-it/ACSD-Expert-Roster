-- Carries the years-of-experience heuristic (previously hardcoded inline in
-- analyze-cv's Claude prompt) as data on each tier, as free text rather than
-- min/max integers to avoid re-litigating "under 3" vs "3-7"'s inclusive/
-- exclusive boundary semantics — this is a faithful port of the exact
-- original wording, not a business-rule change.
begin;

alter table seniority_tiers add column years_hint text;

update seniority_tiers set years_hint = 'under 3 years' where code = 'junior';
update seniority_tiers set years_hint = '3-7 years' where code = 'intermediary';
update seniority_tiers set years_hint = '7-15 years' where code = 'senior';
update seniority_tiers set years_hint = '15+ years' where code = 'principal_expert';

commit;
