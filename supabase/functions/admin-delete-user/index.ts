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
  let body: { userId?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const { userId } = body
  if (!userId) return json({ error: 'userId is required' }, 400)

  // ── Prevent self-deletion ──────────────────────────────────────────────────
  if (userId === user.id) return json({ error: 'You cannot delete your own account' }, 400)

  // ── Remove from app tables before auth deletion ────────────────────────────
  await adminClient.from('user_roles').delete().eq('user_id', userId)
  await adminClient.from('profiles').delete().eq('id', userId)

  // ── Delete from auth ───────────────────────────────────────────────────────
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId)
  if (deleteErr) return json({ error: deleteErr.message }, 400)

  return json({ success: true })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
