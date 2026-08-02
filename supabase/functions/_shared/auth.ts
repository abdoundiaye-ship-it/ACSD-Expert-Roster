import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { respond } from './respond.ts'

export type AuthResult =
  | { ok: true;  user: { id: string; email?: string }; adminClient: SupabaseClient }
  | { ok: false; response: Response }

// Verifies the caller holds a valid session AND has the admin role — the
// standard check for every endpoint that touches privileged data or
// triggers an AI/external call. Mirrors is_admin() on the DB side (see
// migration 0001), which is the RLS-layer equivalent of this same rule.
export async function requireAdmin(req: Request): Promise<AuthResult> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return { ok: false, response: respond({ error: 'Missing Authorization header' }, 401) }

  const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token)
  if (userErr || !user) return { ok: false, response: respond({ error: 'Unauthorized' }, 401) }

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: roleRow } = await adminClient.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (roleRow?.role !== 'admin') return { ok: false, response: respond({ error: 'Forbidden — admin role required' }, 403) }

  return { ok: true, user, adminClient }
}

export type TrustedCallerResult =
  | { ok: true; isServiceRole: true;  adminClient: SupabaseClient }
  | { ok: true; isServiceRole: false; user: { id: string; email?: string }; adminClient: SupabaseClient }
  | { ok: false; response: Response }

// For the two endpoints a scheduled pg_cron job also calls directly with
// the project's own service-role key (scan-opportunities,
// send-notification-digest) — the service-role key is treated as an
// already-trusted system caller, bypassing the getUser()/role lookup
// that only makes sense for a real user session. Anyone else still needs
// a real admin session, so this can also be triggered manually for testing.
export async function requireAdminOrServiceRole(req: Request): Promise<TrustedCallerResult> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return { ok: false, response: respond({ error: 'Missing Authorization header' }, 401) }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)

  if (token === serviceRoleKey) return { ok: true, isServiceRole: true, adminClient }

  const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token)
  if (userErr || !user) return { ok: false, response: respond({ error: 'Unauthorized' }, 401) }

  const { data: roleRow } = await adminClient.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (roleRow?.role !== 'admin') return { ok: false, response: respond({ error: 'Forbidden — admin role required' }, 403) }

  return { ok: true, isServiceRole: false, user, adminClient }
}
