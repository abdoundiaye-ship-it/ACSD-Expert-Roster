-- Add 6 new priority sectors covering administrative/institutional expertise
-- (applied via Supabase service-role client; recorded here for audit trail)
insert into sectors (name, sort_order) values
  ('Administrative Management Specialist', 24),
  ('Digital Transformation & IT Governance', 25),
  ('Procurement & Contract Management', 26),
  ('HR Strategy & Organizational Development', 27),
  ('Institutional Capacity Building & Reform', 28),
  ('Strategic Planning & Policy Advisory', 29);
