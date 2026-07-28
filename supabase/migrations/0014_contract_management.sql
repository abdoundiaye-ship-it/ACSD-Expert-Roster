-- ================================================================
-- ACSD Expert Roster — Contract Management
-- Migration 0014
-- Run in: Supabase Dashboard → SQL Editor
--
-- Post-award tracking — the delivery-side counterpart to the bid-side
-- pipeline (Opportunities → Matching → Proposals) already live. A contract
-- optionally originates from a won opportunity, and holds milestones —
-- deliverables and/or payment obligations, since not every obligation
-- carries a payment (e.g. a quarterly compliance report has a due date
-- and no amount, a deliverable usually has both).
-- ================================================================

-- ── 1. Contracts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contracts (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id      uuid        REFERENCES opportunities(id) ON DELETE SET NULL,
  title               text        NOT NULL,
  contract_number     text,                        -- the client/donor's own reference number, if any
  client_organization text        NOT NULL,
  donor_id            smallint    REFERENCES donors(id),
  contract_value      numeric(14,2),
  currency            text        NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'EUR', 'GBP', 'XOF')),
  status              text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'terminated')),
  signed_date         date,
  start_date          date,
  end_date            date,
  notes               text,
  file_storage_path   text,                        -- the signed agreement, optional
  file_name           text,
  created_by          uuid        REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contracts_status_idx       ON contracts (status);
CREATE INDEX IF NOT EXISTS contracts_opportunity_idx  ON contracts (opportunity_id);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts_read"  ON contracts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "contracts_admin" ON contracts FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 2. Milestones (deliverables and/or payment obligations) ────────

CREATE TABLE IF NOT EXISTS contract_milestones (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id  uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  description  text,
  due_date     date,
  amount       numeric(14,2),                      -- null for a non-payment obligation (e.g. a compliance report)
  -- Linear lifecycle: not_started → delivered → invoiced → paid. "Overdue"
  -- is deliberately not a stored status — it's derived in the UI from
  -- due_date < today AND status not in ('delivered','invoiced','paid'),
  -- so it can never go stale the way a stored flag could.
  status       text        NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'delivered', 'invoiced', 'paid')),
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_milestones_contract_idx ON contract_milestones (contract_id);

ALTER TABLE contract_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract_milestones_read"  ON contract_milestones FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "contract_milestones_admin" ON contract_milestones FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 3. Storage bucket for signed agreements ─────────────────────────
-- Mirrors expert-cvs / opportunity-tors / knowledge-base exactly (admin
-- write, authenticated read).

INSERT INTO storage.buckets (id, name, public)
VALUES ('contracts', 'contracts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "admin manage contract files"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'contracts' AND is_admin())
  WITH CHECK (bucket_id = 'contracts' AND is_admin());

CREATE POLICY "authenticated view contract files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'contracts');
