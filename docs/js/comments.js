'use strict'

// ── Collaboration Workspace — reusable in-context comment threads ──────────
// Attaches a lightweight, one-level-deep comment/reply thread to any record
// via a polymorphic (entity_type, entity_id) pair — same convention
// audit_logs already uses for pointing at "whatever record this was about."
// Currently wired into opportunity-detail.html (the opportunity itself, and
// each generated proposal document). Any other page can adopt it by
// including this script and calling renderComments(container, entityType, entityId).
//
// author_id references auth.users(id), not profiles(id) directly, so it
// can't be embedded via a PostgREST `.select('*, profiles(...))` join (the
// same reason tasks.html resolves assigned_to by looking it up in a
// separately-fetched profiles list instead of embedding it) — profiles are
// fetched once and cached here, then matched by id in JS.

let _commentsProfiles = null
let _commentsCache = {}      // `${entityType}:${entityId}` -> raw rows from the DB
let _commentsContainers = {} // `${entityType}:${entityId}` -> the container element currently showing it

async function getCommentsProfiles() {
  if (_commentsProfiles) return _commentsProfiles
  const { data } = await sb.from('profiles').select('id, full_name, email')
  _commentsProfiles = data ?? []
  return _commentsProfiles
}

async function renderComments(container, entityType, entityId) {
  const key = `${entityType}:${entityId}`
  _commentsContainers[key] = container
  container.innerHTML = '<p class="text-xs text-gray-400">Loading…</p>'

  const [profiles, commentsRes] = await Promise.all([
    getCommentsProfiles(),
    sb.from('comments').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at'),
  ])
  if (commentsRes.error) {
    container.innerHTML = `<p class="text-xs text-red-500">Failed to load comments: ${aesc(commentsRes.error.message)}</p>`
    return
  }
  _commentsCache[key] = commentsRes.data ?? []
  drawComments(entityType, entityId)
}

function authorName(authorId) {
  const profile = (_commentsProfiles ?? []).find(p => p.id === authorId)
  return profile ? (profile.full_name || profile.email) : 'Unknown'
}

function drawComments(entityType, entityId) {
  const key = `${entityType}:${entityId}`
  const container = _commentsContainers[key]
  if (!container) return
  const rows = _commentsCache[key] ?? []
  const topLevel = rows.filter(c => !c.parent_comment_id)
  const repliesOf = pid => rows.filter(c => c.parent_comment_id === pid)
  const idSafe = cssId(key)

  const threadHtml = topLevel.length === 0
    ? '<p class="text-xs text-gray-400">No comments yet — start the discussion below.</p>'
    : topLevel.map(c => commentHtml(c, entityType, entityId)
        + repliesOf(c.id).map(r => commentHtml(r, entityType, entityId, true)).join('')).join('')

  container.innerHTML = `
    <div class="space-y-3">${threadHtml}</div>
    <div class="mt-3 flex gap-2">
      <textarea id="cw-new-${idSafe}" rows="2" placeholder="Add a comment…"
        class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs resize-y"></textarea>
      <button onclick="postComment('${aesc(entityType)}', '${aesc(entityId)}', null, 'cw-new-${idSafe}')"
        class="text-xs bg-blue-900 hover:bg-blue-800 text-white px-3 py-2 rounded-lg self-end flex-shrink-0">Post</button>
    </div>`
}

function cssId(key) {
  return key.replace(/[^a-zA-Z0-9]/g, '_')
}

function commentHtml(c, entityType, entityId, isReply = false) {
  return `
    <div class="${isReply ? 'ml-6 mt-2' : ''} border border-gray-200 rounded-lg p-2.5 ${c.resolved ? 'bg-gray-50 opacity-70' : 'bg-white'}">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-semibold text-gray-700">${aesc(authorName(c.author_id))} <span class="text-gray-400 font-normal">· ${fmtDate(c.created_at)}</span></p>
        ${c.resolved ? '<span class="text-[10px] font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full flex-shrink-0">Resolved</span>' : ''}
      </div>
      <p class="text-sm text-gray-800 mt-1 whitespace-pre-wrap">${aesc(c.content)}</p>
      <div class="flex gap-3 mt-1.5">
        ${!isReply ? `<button onclick="toggleReplyBox('${aesc(c.id)}')" class="text-[11px] text-blue-600 hover:text-blue-800 font-medium">Reply</button>` : ''}
        ${!isReply ? `<button onclick="toggleResolved('${aesc(entityType)}', '${aesc(entityId)}', '${aesc(c.id)}', ${c.resolved})" class="text-[11px] text-gray-500 hover:text-gray-700 font-medium">${c.resolved ? 'Reopen' : 'Resolve'}</button>` : ''}
        <button onclick="deleteComment('${aesc(entityType)}', '${aesc(entityId)}', '${aesc(c.id)}')" class="text-[11px] text-red-500 hover:text-red-700 font-medium">Delete</button>
      </div>
      ${!isReply ? `
      <div id="reply-box-${aesc(c.id)}" class="hidden mt-2 flex gap-2">
        <textarea id="reply-text-${aesc(c.id)}" rows="1" placeholder="Reply…" class="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs resize-y"></textarea>
        <button onclick="postComment('${aesc(entityType)}', '${aesc(entityId)}', '${aesc(c.id)}', 'reply-text-${aesc(c.id)}')"
          class="text-[11px] bg-blue-900 hover:bg-blue-800 text-white px-2 py-1 rounded-lg flex-shrink-0">Send</button>
      </div>` : ''}
    </div>`
}

function toggleReplyBox(commentId) {
  document.getElementById(`reply-box-${commentId}`)?.classList.toggle('hidden')
}

async function postComment(entityType, entityId, parentId, textareaId) {
  const textarea = document.getElementById(textareaId)
  const content = textarea?.value.trim()
  if (!content) return

  const { data: { user } } = await sb.auth.getUser()
  const { error } = await sb.from('comments').insert({
    entity_type: entityType,
    entity_id: entityId,
    parent_comment_id: parentId,
    content,
    author_id: user?.id ?? null,
  })
  if (error) { showToast('Failed to post comment: ' + error.message, 'error'); return }
  await renderComments(_commentsContainers[`${entityType}:${entityId}`], entityType, entityId)
}

async function toggleResolved(entityType, entityId, commentId, currentlyResolved) {
  const { data: { user } } = await sb.auth.getUser()
  const body = currentlyResolved
    ? { resolved: false, resolved_by: null, resolved_at: null }
    : { resolved: true, resolved_by: user?.id ?? null, resolved_at: new Date().toISOString() }
  const { error } = await sb.from('comments').update(body).eq('id', commentId)
  if (error) { showToast('Failed: ' + error.message, 'error'); return }
  await renderComments(_commentsContainers[`${entityType}:${entityId}`], entityType, entityId)
}

async function deleteComment(entityType, entityId, commentId) {
  if (!confirm('Delete this comment? This cannot be undone.')) return
  const { error } = await sb.from('comments').delete().eq('id', commentId)
  if (error) { showToast('Delete failed: ' + error.message, 'error'); return }
  await renderComments(_commentsContainers[`${entityType}:${entityId}`], entityType, entityId)
}

// Total comment count for an entity, used for a badge (e.g. "Comments (3)")
// without the caller having to open the thread first.
async function countComments(entityType, entityId) {
  const { count } = await sb.from('comments').select('id', { count: 'exact', head: true })
    .eq('entity_type', entityType).eq('entity_id', entityId)
  return count ?? 0
}
