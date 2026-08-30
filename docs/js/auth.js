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

// ── Seniority tiers (shared reference data) ─────────────────────────────────
// seniority_tier is a real lookup table (seniority_tiers), not a hardcoded
// enum — every page that shows, filters, or selects a tier goes through
// this instead of its own copy of the 4-value list, so a tier added or
// renamed via Reference Data shows up everywhere without a code change.
// Cached per page load; auth.js is the one shared script every relevant
// page already loads (app.js/admin.js/reports.html do not all overlap).

let _seniorityTiers = null

async function loadSeniorityTiers() {
  if (_seniorityTiers) return _seniorityTiers
  const { data, error } = await sb.from('seniority_tiers').select('id, code, name, sort_order').order('sort_order')
  if (error) { console.error('[loadSeniorityTiers]', error.message); return [] }
  _seniorityTiers = data ?? []
  return _seniorityTiers
}

// Prefers the i18n translation for the 4 original tiers (so existing FR/EN
// labels are unchanged); falls back to the tier's own `name` column for any
// tier added later that has no i18n entry, then to the raw code as a last resort.
function seniorityTierLabel(code) {
  if (!code) return ''
  const key = 'seniority_' + code
  const translated = typeof t === 'function' ? t(key) : key
  if (translated !== key) return translated
  return _seniorityTiers?.find(x => x.code === code)?.name ?? code
}

// ── Authentication ─────────────────────────────────────────────────────────────

async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) { window.location.href = getLoginPath(); return null }
  return session
}

async function getUserRole() {
  // getUser() does a server-side token validation, ensuring the client
  // has the correct auth state before the DB query runs.
  const { data: { user }, error: authErr } = await sb.auth.getUser()
  if (authErr || !user) return 'viewer'

  const { data, error } = await sb
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) console.error('[getUserRole]', error.message, error)
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
