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
    await insertNotificationBell(logoutBtn, session.user.id)
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
  // development (Opportunities, bid-side), delivery (post-award), and system
  // administration — with Dashboard, Tasks, Meetings, and Reports left
  // ungrouped since they're cross-cutting entry/exit points (a task or
  // meeting can belong to a bid OR a contract OR neither, so it doesn't fit
  // either side cleanly).
  const groups = [
    { label: null, items: [
      { id: 'index',    href: 'index.html',    label: t('nav_dashboard') },
      { id: 'tasks',    href: 'tasks.html',    label: t('nav_tasks') },
      { id: 'meetings', href: 'meetings.html', label: t('nav_meetings') },
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
    { label: t('nav_group_delivery'), items: [
      { id: 'clients',   href: 'clients.html',   label: t('nav_clients') },
      { id: 'contracts', href: 'contracts.html', label: t('nav_contracts') },
    ] },
    { label: t('nav_group_admin'), items: [
      { id: 'users',    href: 'users.html',    label: t('nav_users') },
      { id: 'roles',    href: 'roles.html',    label: t('nav_roles') },
      { id: 'webhooks', href: 'webhooks.html', label: t('nav_webhooks') },
      { id: 'audit',    href: 'audit.html',    label: t('nav_audit') },
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

// ── Notifications (bell dropdown) ───────────────────────────────────────────────
// Reload-based, not push/real-time — consistent with the rest of this app,
// which has no websocket/Realtime subscriptions anywhere else. Refreshes on
// page load and whenever the dropdown is opened. RLS scopes every query to
// auth.uid() = user_id automatically (migration 0018), so this can safely
// use the regular anon-key client — no service-role calls from the browser.

let _notifUserId = null
let _notifications = []

async function insertNotificationBell(beforeEl, userId) {
  if (!beforeEl || !beforeEl.parentElement) return
  _notifUserId = userId

  const wrap = document.createElement('div')
  wrap.className = 'relative flex-shrink-0'
  wrap.id = 'notif-bell-wrap'
  wrap.innerHTML = `
    <button type="button" onclick="toggleNotificationDropdown()" class="relative text-xs bg-blue-900 hover:bg-blue-800 px-2.5 py-1.5 rounded-lg transition-colors" aria-label="Notifications">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
      </svg>
      <span id="notif-badge" class="hidden absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center"></span>
    </button>
    <div id="notif-dropdown" class="hidden absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl shadow-2xl border border-gray-200 z-50 text-gray-800">
      <div class="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <p class="text-xs font-bold text-gray-700">Notifications</p>
        <button onclick="markAllNotificationsRead()" class="text-[11px] text-blue-600 hover:text-blue-800 font-medium">Mark all read</button>
      </div>
      <div id="notif-list" class="divide-y divide-gray-50"></div>
    </div>`
  beforeEl.parentElement.insertBefore(wrap, beforeEl)

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) document.getElementById('notif-dropdown')?.classList.add('hidden')
  })

  await loadNotifications()
}

async function loadNotifications() {
  if (!_notifUserId) return
  const { data, error } = await sb.from('notifications')
    .select('*').eq('user_id', _notifUserId).order('created_at', { ascending: false }).limit(20)
  if (error) return
  _notifications = data ?? []
  renderNotificationBadge()
  renderNotificationList()
}

function renderNotificationBadge() {
  const badge = document.getElementById('notif-badge')
  if (!badge) return
  const unread = _notifications.filter(n => !n.read).length
  if (unread === 0) { badge.classList.add('hidden'); return }
  badge.textContent = unread > 9 ? '9+' : String(unread)
  badge.classList.remove('hidden')
}

function renderNotificationList() {
  const list = document.getElementById('notif-list')
  if (!list) return
  if (_notifications.length === 0) {
    list.innerHTML = '<p class="text-xs text-gray-400 text-center py-6">No notifications yet.</p>'
    return
  }
  list.innerHTML = _notifications.map(n => `
    <button onclick="openNotification('${aesc(n.id)}')" class="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors ${n.read ? '' : 'bg-blue-50/50'}">
      <div class="flex items-start gap-2">
        <span class="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.read ? '' : 'bg-blue-600'}"></span>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-gray-800">${aesc(n.title)}</p>
          ${n.body ? `<p class="text-xs text-gray-500 mt-0.5 line-clamp-2">${aesc(n.body)}</p>` : ''}
          <p class="text-[10px] text-gray-400 mt-1">${fmtDate(n.created_at)}</p>
        </div>
      </div>
    </button>`).join('')
}

function toggleNotificationDropdown() {
  const dd = document.getElementById('notif-dropdown')
  if (!dd) return
  const opening = dd.classList.contains('hidden')
  dd.classList.toggle('hidden')
  if (opening) loadNotifications()
}

async function openNotification(id) {
  const n = _notifications.find(x => x.id === id)
  if (!n) return
  if (!n.read) {
    await sb.from('notifications').update({ read: true }).eq('id', id)
    n.read = true
    renderNotificationBadge()
    renderNotificationList()
  }
  if (n.link_url) window.location.href = n.link_url
}

async function markAllNotificationsRead() {
  const unreadIds = _notifications.filter(n => !n.read).map(n => n.id)
  if (unreadIds.length === 0) return
  await sb.from('notifications').update({ read: true }).in('id', unreadIds)
  _notifications.forEach(n => { n.read = true })
  renderNotificationBadge()
  renderNotificationList()
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
