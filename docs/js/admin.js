'use strict'

// ── Admin bootstrap ────────────────────────────────────────────────────────────

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
  if (logoutBtn) logoutBtn.addEventListener('click', logout)

  renderAdminNav(activePage)
  setupSessionTimeout()
  return session
}

// ── Navigation ─────────────────────────────────────────────────────────────────

function renderAdminNav(active) {
  const items = [
    { id: 'index',   href: 'index.html',   label: 'Dashboard' },
    { id: 'users',   href: 'users.html',   label: 'Users' },
    { id: 'experts', href: 'experts.html', label: 'Experts' },
    { id: 'opportunities', href: 'opportunities.html', label: 'Opportunities' },
    { id: 'sources', href: 'sources.html', label: 'Intelligence Sources' },
    { id: 'roles',   href: 'roles.html',   label: 'Roles & Permissions' },
    { id: 'audit',   href: 'audit.html',   label: 'Audit Logs' },
    { id: 'reports', href: '../reports.html', label: 'Reports' },
  ]
  const nav = document.getElementById('admin-nav')
  if (!nav) return
  nav.innerHTML = items.map(it => `
    <a href="${it.href}"
       class="block px-3 py-2 rounded-lg text-sm transition-colors
              ${it.id === active
                ? 'bg-blue-50 text-blue-900 font-semibold'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}">
      ${aesc(it.label)}
    </a>`).join('')
}

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

// Close any modal on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.admin-modal').forEach(m => {
      m.classList.add('hidden')
      document.body.style.overflow = ''
    })
  }
})
