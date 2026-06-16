-- ================================================================
-- ACSD Expert Roster — Security & Access Management Module
-- Migration 0002
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- ── 1. User profiles (auto-synced from auth.users via trigger) ────

CREATE TABLE IF NOT EXISTS profiles (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  full_name  text        NOT NULL DEFAULT '',
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill existing users
INSERT INTO profiles (id, email, full_name)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', '')
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── 2. Permissions registry ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS permissions (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text UNIQUE NOT NULL,
  description text,
  sort_order  int  NOT NULL DEFAULT 0
);

-- ── 3. Role → permission mapping ─────────────────────────────────

CREATE TABLE IF NOT EXISTS role_permissions (
  role          text NOT NULL,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_id)
);

-- ── 4. Audit log (immutable — no UPDATE/DELETE policies) ──────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp       timestamptz NOT NULL DEFAULT now(),
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email      text        NOT NULL,
  action          text        NOT NULL,
  entity_type     text,
  entity_id       text,
  entity_name     text,
  previous_values jsonb,
  new_values      jsonb
);

-- ── 5. Extend experts table ───────────────────────────────────────

ALTER TABLE experts
  ADD COLUMN IF NOT EXISTS first_name  text,
  ADD COLUMN IF NOT EXISTS last_name   text,
  ADD COLUMN IF NOT EXISTS email       text,
  ADD COLUMN IF NOT EXISTS phone       text,
  ADD COLUMN IF NOT EXISTS is_active   boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- Backfill first/last from full_name for the 37 seeded experts
UPDATE experts
SET
  first_name = split_part(trim(full_name), ' ', 1),
  last_name  = trim(substring(trim(full_name) FROM position(' ' IN trim(full_name)) + 1))
WHERE first_name IS NULL;

-- ── 6. Triggers: auto-stamp updated_at ───────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS experts_updated_at  ON experts;
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;

CREATE TRIGGER experts_updated_at
  BEFORE UPDATE ON experts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 7. Auto-create profile when a user signs up ───────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── 8. Seed permissions ───────────────────────────────────────────

INSERT INTO permissions (name, description, sort_order) VALUES
  ('experts:read',       'View expert profiles and roster',           10),
  ('experts:write',      'Create and update expert records',          20),
  ('experts:delete',     'Delete expert records',                     30),
  ('experts:activate',   'Activate or deactivate expert profiles',    40),
  ('users:read',         'View user accounts',                        50),
  ('users:write',        'Invite and update user accounts',           60),
  ('users:activate',     'Activate or deactivate user accounts',      70),
  ('roles:manage',       'Assign and revoke user roles',              80),
  ('permissions:manage', 'Configure role-permission assignments',      90),
  ('audit:read',         'View audit logs',                          100),
  ('cvs:download',       'Download expert CV documents',             110)
ON CONFLICT (name) DO NOTHING;

-- ── 9. Assign permissions to roles ───────────────────────────────

-- Admin gets all permissions
INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', id FROM permissions
ON CONFLICT DO NOTHING;

-- Viewer gets read + CV download only
INSERT INTO role_permissions (role, permission_id)
SELECT 'viewer', id FROM permissions
WHERE name IN ('experts:read', 'cvs:download')
ON CONFLICT DO NOTHING;

-- ── 10. Row Level Security ────────────────────────────────────────

ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY;

-- experts: replace any old policies with clean new ones
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE tablename = 'experts' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON experts', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "experts_read"   ON experts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "experts_insert" ON experts FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "experts_update" ON experts FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "experts_delete" ON experts FOR DELETE USING (is_admin());

-- user_roles: replace old policies
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE tablename = 'user_roles' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON user_roles', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "user_roles_admin" ON user_roles FOR ALL    USING (is_admin())          WITH CHECK (is_admin());
CREATE POLICY "user_roles_self"  ON user_roles FOR SELECT USING (user_id = auth.uid());

-- profiles
CREATE POLICY "profiles_admin_all"   ON profiles FOR ALL    USING (is_admin())       WITH CHECK (is_admin());
CREATE POLICY "profiles_self_read"   ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_self_update" ON profiles FOR UPDATE USING (id = auth.uid())  WITH CHECK (id = auth.uid());

-- permissions & role_permissions: authenticated read, admin write
CREATE POLICY "permissions_read"  ON permissions      FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "permissions_admin" ON permissions      FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "rp_read"           ON role_permissions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "rp_admin"          ON role_permissions FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- audit_logs: authenticated INSERT; admin SELECT only; no UPDATE/DELETE
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "audit_read"   ON audit_logs FOR SELECT USING (is_admin());
