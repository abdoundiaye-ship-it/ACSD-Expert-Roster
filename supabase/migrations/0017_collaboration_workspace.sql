-- ================================================================
-- ACSD Expert Roster — Collaboration Workspace
-- Migration 0017
-- Run in: Supabase Dashboard → SQL Editor
--
-- In-context comment/review threads attached to a record via a polymorphic
-- (entity_type, entity_id) pair — the same "point at whatever record this
-- was about" convention audit_logs already uses. Replies are one level
-- deep (a comment can reply to a top-level comment, not to another reply),
-- which keeps threads readable without building a full nested-tree UI.
--
-- Wired into the two places named in the original roadmap entry
-- ("in-context comments and review threads on live opportunities and
-- drafts"): the opportunity itself (a general discussion thread) and each
-- generated proposal document (a per-document review thread). Any other
-- page can adopt the same shared docs/js/comments.js module later by
-- calling renderComments() with its own entity_type/entity_id — doing so
-- for a new entity type also means adding it to the CHECK constraint below.
-- ================================================================

CREATE TABLE IF NOT EXISTS comments (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type       text        NOT NULL CHECK (entity_type IN ('opportunity', 'proposal_document')),
  entity_id         uuid        NOT NULL,
  parent_comment_id uuid        REFERENCES comments(id) ON DELETE CASCADE,
  content           text        NOT NULL,
  author_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved          boolean     NOT NULL DEFAULT false,
  resolved_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_entity_idx ON comments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_comment_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments_read"  ON comments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "comments_admin" ON comments FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
