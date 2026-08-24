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
// just the "Sign out" button. (The "← Back to Roster" link now lives inside
// #admin-nav itself, so renderAdminNav's own t() calls keep it translated.)
function translateAdminChrome() {
  const logoutBtn = document.getElementById('admin-logout-btn')
  if (logoutBtn) logoutBtn.textContent = t('logout_btn')
}

document.addEventListener('acsd:langchange', () => {
  translateAdminChrome()
  if (_adminActivePage) renderAdminNav(_adminActivePage)
})

// ── Navigation ─────────────────────────────────────────────────────────────────

// Simple 2-3 stroke shapes, not a copied icon library — kept deliberately
// minimal so every path is something we can verify by eye rather than
// trusting from memory.
const NAV_ICONS = {
  index:              '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tasks:              '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
  meetings:           '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  reports:            '<path d="M4 20V10M10 20V4M16 20v-7M4 20h16"/>',
  experts:            '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  ask:                '<path d="M4 4h16v12H8l-4 4V4z"/>',
  opportunities:      '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/>',
  sources:            '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
  'knowledge-base':   '<path d="M4 5a2 2 0 012-2h6v18H6a2 2 0 01-2-2V5z"/><path d="M12 3h6a2 2 0 012 2v14a2 2 0 01-2 2h-6"/>',
  'lessons-learned':  '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3 11.2c.6.4 1 1.1 1 1.8h4c0-.7.4-1.4 1-1.8A6 6 0 0012 3z"/>',
  clients:            '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/>',
  contracts:          '<path d="M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>',
  users:              '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 19a6 6 0 0111 0"/>',
  roles:              '<path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z"/><path d="M9.5 12l2 2 3.5-4"/>',
  webhooks:           '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
  audit:              '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20"/>',
  'back-to-roster':   '<path d="M11 4l-7 8 7 8M4 12h16"/>',
}

function _navIcon(id) {
  return `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${NAV_ICONS[id] || ''}</svg>`
}

function _navLink(it, active) {
  return `
    <a href="${it.href}" onclick="closeMobileNav()"
       class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors border-l-2
              ${it.id === active
                ? 'bg-blue-50 text-blue-900 font-semibold border-blue-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border-transparent'}">
      ${_navIcon(it.id)}<span>${aesc(it.label)}</span>
    </a>`
}

function toggleNavGroup(key) {
  const collapsed = localStorage.getItem('acsd_nav_collapsed_' + key) === 'true'
  localStorage.setItem('acsd_nav_collapsed_' + key, String(!collapsed))
  if (_adminActivePage) renderAdminNav(_adminActivePage)
}

function renderAdminNav(active) {
  // Dashboard, Tasks, Meetings, and Reports are cross-cutting entry/exit
  // points (a task or meeting can belong to a bid OR a contract OR neither,
  // and Reports pulls from every entity), so they stay ungrouped at the
  // top. The remaining groups mirror the platform's functional areas:
  // talent (Roster), business development (Opportunities, bid-side),
  // delivery (post-award), and system administration — the last of which
  // is config/setup work rather than daily workflow, so it collapses by
  // default to keep the common case short.
  const primary = [
    { id: 'index',    href: 'index.html',      label: t('nav_dashboard') },
    { id: 'tasks',    href: 'tasks.html',      label: t('nav_tasks') },
    { id: 'meetings', href: 'meetings.html',   label: t('nav_meetings') },
    { id: 'reports',  href: '../reports.html', label: t('nav_reports') },
  ]
  const groups = [
    { key: 'roster', label: t('nav_group_roster'), items: [
      { id: 'experts', href: 'experts.html', label: t('nav_experts') },
      { id: 'ask',     href: 'ask.html',     label: t('nav_ask') },
    ] },
    { key: 'opportunities', label: t('nav_group_opportunities'), items: [
      { id: 'opportunities',      href: 'opportunities.html',     label: t('nav_opportunities') },
      { id: 'sources',            href: 'sources.html',           label: t('nav_sources') },
      { id: 'knowledge-base',     href: 'knowledge-base.html',    label: t('nav_knowledge_base') },
      { id: 'lessons-learned',    href: 'lessons-learned.html',   label: t('nav_lessons_learned') },
    ] },
    { key: 'delivery', label: t('nav_group_delivery'), items: [
      { id: 'clients',   href: 'clients.html',   label: t('nav_clients') },
      { id: 'contracts', href: 'contracts.html', label: t('nav_contracts') },
    ] },
    { key: 'admin', label: t('nav_group_admin'), collapsible: true, items: [
      { id: 'users',    href: 'users.html',    label: t('nav_users') },
      { id: 'roles',    href: 'roles.html',    label: t('nav_roles') },
      { id: 'webhooks', href: 'webhooks.html', label: t('nav_webhooks') },
      { id: 'audit',    href: 'audit.html',    label: t('nav_audit') },
    ] },
  ]
  const nav = document.getElementById('admin-nav')
  if (!nav) return

  const backLink = `
    <a href="../index.html" onclick="closeMobileNav()"
       class="flex items-center gap-2.5 px-3 py-2 mb-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors border-b border-gray-100">
      ${_navIcon('back-to-roster')}<span>${aesc(t('back_to_roster'))}</span>
    </a>`

  const quickAdd = `
    <div class="flex gap-1.5 mb-2 px-1">
      <a href="experts.html?new=1" onclick="closeMobileNav()" class="flex-1 text-center text-xs font-semibold bg-blue-900 hover:bg-blue-800 text-white px-2 py-1.5 rounded-lg transition-colors">+ ${aesc(t('nav_quick_add_expert'))}</a>
      <a href="opportunities.html?new=1" onclick="closeMobileNav()" class="flex-1 text-center text-xs font-semibold bg-blue-900 hover:bg-blue-800 text-white px-2 py-1.5 rounded-lg transition-colors">+ ${aesc(t('nav_quick_add_opportunity'))}</a>
    </div>`

  const primaryHtml = primary.map(it => _navLink(it, active)).join('')

  const groupsHtml = groups.map(g => {
    const isActiveInGroup = g.items.some(it => it.id === active)
    const raw = localStorage.getItem('acsd_nav_collapsed_' + g.key)
    const storedCollapsed = raw === null ? true : raw === 'true'   // collapsible groups start collapsed until the admin opts in
    const collapsed = !!g.collapsible && storedCollapsed && !isActiveInGroup

    const header = g.collapsible
      ? `<button type="button" onclick="toggleNavGroup('${g.key}')"
           class="w-full flex items-center justify-between px-3 pt-3 pb-1 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider first:pt-0 hover:text-gray-600">
           <span>${aesc(g.label)}</span>
           <svg class="w-3.5 h-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
         </button>`
      : `<p class="px-3 pt-3 pb-1 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider first:pt-0">${aesc(g.label)}</p>`

    return header + (collapsed ? '' : g.items.map(it => _navLink(it, active)).join(''))
  }).join('')

  nav.innerHTML = backLink + quickAdd + primaryHtml + groupsHtml
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
    const { error } = await sb.from('notifications').update({ read: true }).eq('id', id)
    if (error) {
      showToast(t('failed_prefix') + error.message, 'error')
    } else {
      n.read = true
      renderNotificationBadge()
      renderNotificationList()
    }
  }
  if (n.link_url) window.location.href = n.link_url
}

async function markAllNotificationsRead() {
  const unreadIds = _notifications.filter(n => !n.read).map(n => n.id)
  if (unreadIds.length === 0) return
  const { error } = await sb.from('notifications').update({ read: true }).in('id', unreadIds)
  if (error) { showToast(t('failed_prefix') + error.message, 'error'); return }
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

function debounce(fn, ms) {
  let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}

// Lets a keyboard user (dropzones aren't natively focusable/activatable)
// open the same file picker a mouse click on the dropzone triggers.
function triggerFileInputOnKey(event, inputId) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    document.getElementById(inputId).click()
  }
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div')
  el.className = `fixed bottom-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-medium text-white
    ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 3500)
}

let _modalReturnFocusEl = null

function openAdminModal(id) {
  const m = document.getElementById(id)
  if (!m) return
  m.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
  m.setAttribute('role', 'dialog')
  m.setAttribute('aria-modal', 'true')
  if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1')
  _modalReturnFocusEl = document.activeElement
  const focusable = m.querySelector('input, select, textarea, button, [href]')
  ;(focusable || m).focus()
}

function closeAdminModal(id) {
  const m = document.getElementById(id)
  if (m) { m.classList.add('hidden'); document.body.style.overflow = '' }
  if (_modalReturnFocusEl && typeof _modalReturnFocusEl.focus === 'function') {
    _modalReturnFocusEl.focus()
  }
  _modalReturnFocusEl = null
}

// Close any modal (and the mobile nav drawer) on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.admin-modal').forEach(m => {
      if (!m.classList.contains('hidden')) closeAdminModal(m.id)
    })
    closeMobileNav()
  }
})
