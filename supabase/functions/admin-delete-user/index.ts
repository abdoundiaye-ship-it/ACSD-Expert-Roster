import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { respond } from '../_shared/respond.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { CORS } from '../_shared/cors.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { user, adminClient } = auth

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { userId?: string }
  try { body = await req.json() } catch { return respond({ error: 'Invalid JSON body' }, 400) }

  const { userId } = body
  if (!userId) return respond({ error: 'userId is required' }, 400)

  // ── Prevent self-deletion ──────────────────────────────────────────────────
  if (userId === user.id) return respond({ error: 'You cannot delete your own account' }, 400)

  // ── Remove from app tables before auth deletion ────────────────────────────
  await adminClient.from('user_roles').delete().eq('user_id', userId)
  await adminClient.from('profiles').delete().eq('id', userId)

  // ── Delete from auth ───────────────────────────────────────────────────────
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId)
  if (deleteErr) return respond({ error: deleteErr.message }, 400)

  return respond({ success: true })
})
