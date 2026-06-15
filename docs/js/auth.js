/**
 * auth.js — Supabase auth helpers shared across pages.
 * Assumes SUPABASE_URL and SUPABASE_ANON_KEY are already defined (config.js).
 * Assumes the Supabase JS CDN library is already loaded.
 */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) {
    window.location.href = 'login.html'
    return null
  }
  return session
}

async function getUserRole() {
  const { data } = await sb.from('user_roles').select('role').maybeSingle()
  return data?.role ?? 'viewer'
}

function logout() {
  sb.auth.signOut().then(() => { window.location.href = 'login.html' })
}
