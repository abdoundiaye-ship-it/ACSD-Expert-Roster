-- ================================================================
-- ACSD Expert Roster — Client CRM
-- Migration 0020
-- Run in: Supabase Dashboard → SQL Editor
--
-- Structured tracking of client and donor relationships that outlives any
-- one opportunity or contract — the roadmap's own framing: "relationship
-- history retained across staff turnover," not tribal knowledge sitting in
-- one person's inbox or head.
--
-- Distinct from the existing `donors` table (a small, shared lookup used
-- to tag opportunities/experts by funding body, seeded with ~14 entries in
-- migration 0001) — `clients` is the broader relationship record. It can
-- optionally point at a matching `donors` row, but also covers government
-- ministries, NGO primes, and private clients that were never in the
-- donors lookup at all. `donors` is untouched by this migration; it keeps
-- doing exactly what it already did.
-- ================================================================

-- ── 1. Clients ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name               text        NOT NULL,
  type               text        NOT NULL DEFAULT 'other' CHECK (type IN ('donor', 'government', 'ngo', 'private', 'other')),
  donor_id           smallint    REFERENCES donors(id),   -- optional cross-reference to the existing funding-body lookup
  website            text,
  relationship_owner uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'prospective')),
  notes              text,
  created_by         uuid        REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_status_idx ON clients (status);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_read"  ON clients FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "clients_admin" ON clients FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 2. Contacts ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_contacts (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id  uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  role_title text,
  email      text,
  phone      text,
  is_primary boolean     NOT NULL DEFAULT false,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_contacts_client_idx ON client_contacts (client_id);

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_contacts_read"  ON client_contacts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "client_contacts_admin" ON client_contacts FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 3. Interaction log ───────────────────────────────────────────
-- Optionally points at a real row in `meetings` (Meeting Management, if
-- applied) when the interaction was a logged meeting, rather than
-- re-typing what's already recorded there — meeting_id is only set for
-- that case; summary/interaction_date are always filled in regardless of
-- source, so the log reads consistently either way.

CREATE TABLE IF NOT EXISTS client_interactions (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id        uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  interaction_type text        NOT NULL DEFAULT 'other' CHECK (interaction_type IN ('call', 'email', 'meeting', 'other')),
  summary          text        NOT NULL,
  interaction_date date        NOT NULL DEFAULT CURRENT_DATE,
  meeting_id       uuid        REFERENCES meetings(id) ON DELETE SET NULL,
  created_by       uuid        REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_interactions_client_idx ON client_interactions (client_id, interaction_date DESC);

ALTER TABLE client_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_interactions_read"  ON client_interactions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "client_interactions_admin" ON client_interactions FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- ── 4. Roll up existing opportunities/contracts to a client ──────
-- Nullable, additive columns — existing rows are unaffected. The "beyond
-- individual opportunities" view (every opportunity + contract ever tied
-- to this client, in one place) only reflects records that set this going
-- forward, or that get backfilled by hand for pre-existing ones.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE contracts     ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS opportunities_client_idx ON opportunities (client_id);
CREATE INDEX IF NOT EXISTS contracts_client_idx      ON contracts (client_id);

-- ── 5. Reuse Collaboration Workspace for relationship notes ──────
-- Extends the comments.entity_type CHECK — migration 0017 explicitly
-- anticipated this ("doing so for a new entity type also means adding it
-- to the CHECK constraint below") — so a client can carry a general
-- discussion thread the same way an opportunity or proposal document does.
-- Looks the actual constraint name up rather than assuming Postgres's
-- default auto-generated name, so this can't silently leave the old,
-- narrower constraint in place alongside a new one if that guess were ever
-- wrong (harmless if migration 0017 was never applied — the loop just
-- finds nothing to drop, and the ADD CONSTRAINT below still runs).

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    WHERE rel.relname = 'comments' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%entity_type%'
  LOOP
    EXECUTE format('ALTER TABLE comments DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE comments ADD CONSTRAINT comments_entity_type_check
  CHECK (entity_type IN ('opportunity', 'proposal_document', 'client'));
