'use strict'

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Path helpers ───────────────────────────────────────────────────────────────

function getLoginPath() {
  return window.location.pathname.includes('/admin/') ? '../login.html' : 'login.html'
}

// ── Audit logging ──────────────────────────────────────────────────────────────

async function logAudit(action, entityType, entityId, entityName, previousValues, newValues) {
  try {
    const { data: { session } } = await sb.auth.getSession()
    if (!session) return
    await sb.from('audit_logs').insert({
      user_id:         session.user.id,
      user_email:      session.user.email,
      action,
      entity_type:     entityType    ?? null,
      entity_id:       entityId      ? String(entityId) : null,
      entity_name:     entityName    ?? null,
      previous_values: previousValues ?? null,
      new_values:      newValues      ?? null,
    })
  } catch (_) { /* audit failures must never break the main flow */ }
}

// ── Session timeout (30 min inactivity) ───────────────────────────────────────

function setupSessionTimeout() {
  let lastActivity = Date.now()
  const reset = () => { lastActivity = Date.now() }
  document.addEventListener('mousemove', reset, { passive: true })
  document.addEventListener('keydown',   reset, { passive: true })
  document.addEventListener('click',     reset, { passive: true })
  document.addEventListener('scroll',    reset, { passive: true })

  setInterval(async () => {
    if (Date.now() - lastActivity > 30 * 60 * 1000) {
      await logAudit('SESSION_TIMEOUT', 'session', null, 'Automatic logout — inactivity', null, null)
      await sb.auth.signOut()
      window.location.href = getLoginPath()
    }
  }, 60_000)
}

// ── Authentication ─────────────────────────────────────────────────────────────

async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) { window.location.href = getLoginPath(); return null }
  return session
}

async function getUserRole() {
  const { data } = await sb.from('user_roles').select('role').maybeSingle()
  return data?.role ?? 'viewer'
}

async function logout() {
  try {
    const { data: { session } } = await sb.auth.getSession()
    if (session) {
      await logAudit('LOGOUT', 'session', session.user.id, session.user.email, null, null)
    }
  } catch (_) {}
  await sb.auth.signOut()
  window.location.href = getLoginPath()
}
