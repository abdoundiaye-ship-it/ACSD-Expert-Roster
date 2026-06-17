import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return new Response('Method Not Allowed', { status: 405 })

  // ── Verify caller is authenticated ────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const token      = authHeader.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing Authorization header' }, 401)

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token)
  if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

  // ── Verify caller has admin role ───────────────────────────────────────────
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: roleRow } = await adminClient
    .from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (roleRow?.role !== 'admin') return json({ error: 'Forbidden — admin role required' }, 403)

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { email?: string; fullName?: string; role?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const { email, fullName = '', role = 'viewer' } = body
  if (!email) return json({ error: 'email is required' }, 400)
  if (!['admin', 'viewer'].includes(role)) return json({ error: 'role must be admin or viewer' }, 400)

  // ── Create user with a temporary password (no email sent) ─────────────────
  const tempPassword = generateTempPassword()

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,          // skip email verification entirely
    user_metadata: { full_name: fullName },
  })
  if (createErr) return json({ error: createErr.message }, 400)

  const newUserId = created.user?.id
  if (!newUserId) return json({ error: 'User created but ID not returned' }, 500)

  // ── Assign role ────────────────────────────────────────────────────────────
  await adminClient.from('user_roles')
    .upsert({ user_id: newUserId, role }, { onConflict: 'user_id' })

  // Return the temp password so the admin can share it with the new user
  return json({ success: true, userId: newUserId, tempPassword })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateTempPassword(): string {
  // Unambiguous characters (no 0/O, 1/l/I)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
