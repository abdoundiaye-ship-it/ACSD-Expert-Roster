'use strict'

// ── Admin bootstrap ────────────────────────────────────────────────────────────

let _adminActivePage = null

async function initAdmin(activePage) {
  const session = await checkAuth()
  if (!session) return null

  const role = await getUserRole()
  if (role !== 'admin') {
    window.location.href = '../index.html'
    return null
  }

  const emailEl = document.getElementById('admin-user-email')
  if (emailEl) emailEl.textContent = session.user.email

  const logoutBtn = document.getElementById('admin-logout-btn')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout)
    if (typeof i18nInsertToggle === 'function') i18nInsertToggle(logoutBtn, 'dark')
  }
  translateAdminChrome()

  _adminActivePage = activePage
  renderAdminNav(activePage)
  setupSessionTimeout()
  return session
}

// Re-translates the bits of admin chrome that renderAdminNav doesn't own —
// the "Sign out" button and the "← Back to Roster" link, which every admin
// page repeats identically but doesn't tag with an id.
function translateAdminChrome() {
  const logoutBtn = document.getElementById('admin-logout-btn')
  if (logoutBtn) logoutBtn.textContent = t('logout_btn')
  document.querySelectorAll('aside a[href="../index.html"]').forEach(a => {
    a.textContent = t('back_to_roster')
  })
}

document.addEventListener('acsd:langchange', () => {
  translateAdminChrome()
  if (_adminActivePage) renderAdminNav(_adminActivePage)
})

// ── Navigation ─────────────────────────────────────────────────────────────────

function renderAdminNav(active) {
  // Groups mirror the platform's functional areas: talent (Roster), business
  // development (Opportunities), and system administration — with Dashboard
  // and Reports left ungrouped since they're cross-cutting entry/exit points.
  const groups = [
    { label: null, items: [
      { id: 'index', href: 'index.html', label: t('nav_dashboard') },
    ] },
    { label: t('nav_group_roster'), items: [
      { id: 'experts', href: 'experts.html', label: t('nav_experts') },
      { id: 'ask',     href: 'ask.html',     label: t('nav_ask') },
    ] },
    { label: t('nav_group_opportunities'), items: [
      { id: 'opportunities',      href: 'opportunities.html',     label: t('nav_opportunities') },
      { id: 'sources',            href: 'sources.html',           label: t('nav_sources') },
      { id: 'knowledge-base',     href: 'knowledge-base.html',    label: t('nav_knowledge_base') },
      { id: 'lessons-learned',    href: 'lessons-learned.html',   label: t('nav_lessons_learned') },
    ] },
    { label: t('nav_group_admin'), items: [
      { id: 'users', href: 'users.html', label: t('nav_users') },
      { id: 'roles', href: 'roles.html', label: t('nav_roles') },
      { id: 'audit', href: 'audit.html', label: t('nav_audit') },
    ] },
    { label: null, items: [
      { id: 'reports', href: '../reports.html', label: t('nav_reports') },
    ] },
  ]
  const nav = document.getElementById('admin-nav')
  if (!nav) return
  nav.innerHTML = groups.map(g => `
    ${g.label ? `<p class="px-3 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider first:pt-0">${aesc(g.label)}</p>` : ''}
    ${g.items.map(it => `
      <a href="${it.href}" onclick="closeMobileNav()"
         class="block px-3 py-2 rounded-lg text-sm transition-colors
                ${it.id === active
                  ? 'bg-blue-50 text-blue-900 font-semibold'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}">
        ${aesc(it.label)}
      </a>`).join('')}
  `).join('')
}

// ── Mobile navigation (sidebar drawer below the md breakpoint) ─────────────────

function toggleMobileNav() { document.body.classList.toggle('mobile-nav-open') }
function closeMobileNav()  { document.body.classList.remove('mobile-nav-open') }

// ── Shared utilities ───────────────────────────────────────────────────────────

function aesc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div')
  el.className = `fixed bottom-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-medium text-white
    ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 3500)
}

function openAdminModal(id) {
  const m = document.getElementById(id)
  if (m) { m.classList.remove('hidden'); document.body.style.overflow = 'hidden' }
}

function closeAdminModal(id) {
  const m = document.getElementById(id)
  if (m) { m.classList.add('hidden'); document.body.style.overflow = '' }
}

// Close any modal (and the mobile nav drawer) on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.admin-modal').forEach(m => {
      m.classList.add('hidden')
      document.body.style.overflow = ''
    })
    closeMobileNav()
  }
})
