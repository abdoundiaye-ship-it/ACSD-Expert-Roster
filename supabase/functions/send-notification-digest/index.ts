import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

// GitHub Pages base the docs/ folder is deployed to. Every notification's
// link_url is relative to docs/admin/ (where the bell UI that reads it
// always lives), so the email digest below builds the full URL as
// APP_BASE_URL + 'admin/' + link_url.
const APP_BASE_URL = 'https://abdoundiaye-ship-it.github.io/ACSD-Expert-Roster/'

// Runs daily via pg_cron (migration 0018 — 07:00 UTC, one hour after the
// opportunity scan so today's scan_result notification is already in the
// table). Two jobs in one function, same reasoning as scan-opportunities
// bundling multiple source adapters into one dispatch rather than one
// function per adapter:
//   1. Check for approaching deadlines (tasks, meetings, contract
//      milestones, opportunity deadlines) and insert notifications for them.
//   2. Email anyone with unsent notifications — only if RESEND_API_KEY is
//      configured; otherwise this step is skipped and logged, not faked.
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return respond({ error: 'Missing Authorization header' }, 401)

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)

  // Same trusted-caller pattern as scan-opportunities: the scheduled cron
  // job authenticates with the service-role key directly; anyone else must
  // be a real admin (so this can also be triggered manually for testing).
  if (token !== serviceRoleKey) {
    const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(token)
    if (userErr || !user) return respond({ error: 'Unauthorized' }, 401)
    const { data: roleRow } = await adminClient.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleRow?.role !== 'admin') return respond({ error: 'Forbidden — admin role required' }, 403)
  }

  const insertedCount = await checkDeadlines(adminClient)
  const emailResult = await sendDigestEmails(adminClient)

  return respond({ success: true, deadline_notifications_inserted: insertedCount, ...emailResult })
})

// ── 1. Deadline checks ──────────────────────────────────────────────────────

async function checkDeadlines(adminClient: any): Promise<number> {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const in3Days = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const in24h = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const nowIso = today.toISOString()

  const rows: Array<Record<string, unknown>> = []

  // Tasks due within 3 days, not done, with an assignee.
  const { data: tasks } = await adminClient
    .from('tasks').select('id, title, due_date, assigned_to')
    .not('assigned_to', 'is', null).not('due_date', 'is', null)
    .gte('due_date', todayStr).lte('due_date', in3Days).neq('status', 'done')
  for (const t of tasks ?? []) {
    rows.push({
      user_id: t.assigned_to, type: 'task_due_soon',
      title: 'Task due soon', body: `"${t.title}" is due ${t.due_date}.`,
      link_url: 'tasks.html', dedupe_key: `task_due_soon:${t.id}:${t.due_date}`,
    })
  }

  // Meetings starting within the next 24h, still scheduled — notify each
  // internal attendee individually.
  const { data: meetings } = await adminClient
    .from('meetings').select('id, title, start_time, meeting_attendees(profile_id)')
    .eq('status', 'scheduled').gte('start_time', nowIso).lte('start_time', in24h)
  for (const m of meetings ?? []) {
    for (const a of m.meeting_attendees ?? []) {
      rows.push({
        user_id: a.profile_id, type: 'meeting_upcoming',
        title: 'Meeting starting soon', body: `"${m.title}" starts at ${m.start_time}.`,
        link_url: 'meetings.html', dedupe_key: `meeting_upcoming:${m.id}:${a.profile_id}`,
      })
    }
  }

  // Contract milestones due within 3 days, not yet delivered/invoiced/paid —
  // no single owner on a milestone, so this broadcasts to every admin.
  const { data: milestones } = await adminClient
    .from('contract_milestones').select('id, title, due_date, contracts(title)')
    .not('due_date', 'is', null).gte('due_date', todayStr).lte('due_date', in3Days)
    .not('status', 'in', '(delivered,invoiced,paid)')
  if (milestones?.length) {
    const admins = await getAdminIds(adminClient)
    for (const m of milestones) {
      for (const uid of admins) {
        rows.push({
          user_id: uid, type: 'contract_milestone_due',
          title: 'Contract milestone due soon',
          body: `"${m.title}" (${m.contracts?.title ?? 'contract'}) is due ${m.due_date}.`,
          link_url: 'contracts.html', dedupe_key: `contract_milestone_due:${m.id}:${m.due_date}:${uid}`,
        })
      }
    }
  }

  // Opportunity deadlines within 3 days, still open/in progress — same
  // "no single owner" broadcast as milestones above.
  const { data: opportunities } = await adminClient
    .from('opportunities').select('id, title, deadline')
    .not('deadline', 'is', null).gte('deadline', todayStr).lte('deadline', in3Days)
    .in('status', ['open', 'in_progress'])
  if (opportunities?.length) {
    const admins = await getAdminIds(adminClient)
    for (const o of opportunities) {
      for (const uid of admins) {
        rows.push({
          user_id: uid, type: 'opportunity_deadline',
          title: 'Opportunity deadline approaching',
          body: `"${o.title}" is due ${o.deadline}.`,
          link_url: `opportunity-detail.html?id=${o.id}`, dedupe_key: `opportunity_deadline:${o.id}:${o.deadline}:${uid}`,
        })
      }
    }
  }

  if (rows.length === 0) return 0

  // upsert + ignoreDuplicates == INSERT ... ON CONFLICT DO NOTHING, so a
  // rerun (or two overlapping runs) never fails on the unique dedupe index
  // and never double-notifies about the same thing.
  const { error, count } = await adminClient
    .from('notifications')
    .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true, count: 'exact' })
  if (error) {
    console.error('[send-notification-digest] failed to insert deadline notifications', error.message)
    return 0
  }
  return count ?? 0
}

let _adminIdsCache: string[] | null = null
async function getAdminIds(adminClient: any): Promise<string[]> {
  if (_adminIdsCache) return _adminIdsCache
  const { data } = await adminClient.from('user_roles').select('user_id').eq('role', 'admin')
  _adminIdsCache = (data ?? []).map((r: { user_id: string }) => r.user_id)
  return _adminIdsCache!
}

// ── 2. Optional email digest ────────────────────────────────────────────────

async function sendDigestEmails(adminClient: any): Promise<{ emails_sent: number; email_skipped_reason?: string }> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) {
    console.log('[send-notification-digest] RESEND_API_KEY not configured — skipping email step, in-app notifications only')
    return { emails_sent: 0, email_skipped_reason: 'RESEND_API_KEY not configured' }
  }

  const { data: unsent, error } = await adminClient
    .from('notifications').select('id, user_id, title, body, link_url, created_at')
    .eq('notified_via_email', false).order('created_at')
  if (error) {
    console.error('[send-notification-digest] failed to load unsent notifications', error.message)
    return { emails_sent: 0, email_skipped_reason: 'failed to load unsent notifications' }
  }
  if (!unsent || unsent.length === 0) return { emails_sent: 0 }

  const { data: profiles } = await adminClient.from('profiles').select('id, email, full_name')
  const emailById = new Map((profiles ?? []).map((p: { id: string; email: string }) => [p.id, p.email]))

  const byUser = new Map<string, typeof unsent>()
  for (const n of unsent) {
    if (!byUser.has(n.user_id)) byUser.set(n.user_id, [])
    byUser.get(n.user_id)!.push(n)
  }

  let emailsSent = 0
  const sentIds: string[] = []

  for (const [userId, items] of byUser) {
    const email = emailById.get(userId)
    if (!email) continue

    const html = `
      <p>You have ${items.length} update${items.length === 1 ? '' : 's'} on the ACSD Expert Intelligence Platform:</p>
      <ul>
        ${items.map(n => `<li><strong>${escapeHtml(n.title)}</strong>${n.body ? ' — ' + escapeHtml(n.body) : ''}${n.link_url ? ` — <a href="${APP_BASE_URL}admin/${n.link_url}">View</a>` : ''}</li>`).join('')}
      </ul>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ACSD Platform <onboarding@resend.dev>',
        to: [email],
        subject: `ACSD Platform — ${items.length} update${items.length === 1 ? '' : 's'}`,
        html,
      }),
    })
    if (res.ok) {
      emailsSent++
      sentIds.push(...items.map(n => n.id))
    } else {
      console.error('[send-notification-digest] Resend API error', res.status, (await res.text()).slice(0, 300))
    }
  }

  if (sentIds.length > 0) {
    const { error: markErr } = await adminClient.from('notifications').update({ notified_via_email: true }).in('id', sentIds)
    if (markErr) console.error('[send-notification-digest] failed to mark notifications as emailed', markErr.message)
  }

  return { emails_sent: emailsSent }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
