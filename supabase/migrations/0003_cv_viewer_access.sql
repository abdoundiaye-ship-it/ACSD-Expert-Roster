-- ================================================================
-- ACSD Expert Roster — Migration 0003
-- Allow all authenticated users to view (open signed URLs for) CVs
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- All authenticated users can read CV files (needed to create signed URLs).
-- Admins retain full write access via the existing "admin manage cv files" policy.
CREATE POLICY "authenticated view cv files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'expert-cvs');
