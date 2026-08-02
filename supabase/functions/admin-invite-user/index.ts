import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { respond } from '../_shared/respond.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { CORS } from '../_shared/cors.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { email?: string; fullName?: string; role?: string }
  try { body = await req.json() } catch { return respond({ error: 'Invalid JSON body' }, 400) }

  const { email, fullName = '', role = 'viewer' } = body
  if (!email) return respond({ error: 'email is required' }, 400)
  if (!['admin', 'viewer'].includes(role)) return respond({ error: 'role must be admin or viewer' }, 400)

  // ── Create user with a temporary password (no email sent) ─────────────────
  const tempPassword = generateTempPassword()

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,          // skip email verification entirely
    user_metadata: { full_name: fullName },
  })
  if (createErr) return respond({ error: createErr.message }, 400)

  const newUserId = created.user?.id
  if (!newUserId) return respond({ error: 'User created but ID not returned' }, 500)

  // ── Assign role ────────────────────────────────────────────────────────────
  await adminClient.from('user_roles')
    .upsert({ user_id: newUserId, role }, { onConflict: 'user_id' })

  // Return the temp password so the admin can share it with the new user
  return respond({ success: true, userId: newUserId, tempPassword })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateTempPassword(): string {
  // Unambiguous characters (no 0/O, 1/l/I)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}
