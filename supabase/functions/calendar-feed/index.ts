import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

// Deliberately NOT the standard Bearer-JWT pattern every other function in
// this project uses. Calendar apps subscribe to an .ics URL with periodic,
// unauthenticated GET requests — there is no interactive login step for
// them to complete. Security here comes from the URL itself: a per-user,
// unguessable token (profiles.calendar_token), the same "capability URL"
// pattern used by comparable calendar-feed features elsewhere (Trello,
// Asana, GitHub). The feed only ever exposes tasks assigned to that one
// token's owner, so a leaked URL exposes one person's task list, not the
// whole team's.
//
// MUST be deployed with the JWT check disabled — Supabase's own gateway
// rejects any request without a valid Authorization header before this
// code ever runs, and calendar apps never send one. Deploy with:
//   supabase functions deploy calendar-feed --no-verify-jwt
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'GET') return respondText('Method Not Allowed', 405)

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return respondText('Missing token', 400)

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('id, full_name, email')
    .eq('calendar_token', token)
    .maybeSingle()
  if (profileErr || !profile) return respondText('Invalid calendar token', 404)

  // Only open/in-progress tasks with a due date — a calendar feed is for
  // what's coming up, not a historical archive of finished work.
  const { data: tasks, error: tasksErr } = await adminClient
    .from('tasks')
    .select('id, title, description, due_date, priority, status')
    .eq('assigned_to', profile.id)
    .not('due_date', 'is', null)
    .in('status', ['open', 'in_progress'])
    .order('due_date')
  if (tasksErr) return respondText('Failed to load tasks', 500)

  const calendarName = `ACSD Tasks — ${profile.full_name || profile.email}`
  const ics = buildIcs(calendarName, tasks ?? [])

  return new Response(ics, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="acsd-tasks.ics"',
      'Cache-Control': 'no-cache',
    },
  })
})

interface TaskRow {
  id: string
  title: string
  description: string | null
  due_date: string // YYYY-MM-DD
  priority: string
  status: string
}

function buildIcs(calendarName: string, tasks: TaskRow[]): string {
  const now = icsTimestamp(new Date())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ACSD Expert Intelligence Platform//Tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ]

  for (const task of tasks) {
    const priorityTag = task.priority === 'high' ? '[HIGH] ' : ''
    lines.push(
      'BEGIN:VEVENT',
      `UID:acsd-task-${task.id}@acsd-eip`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${task.due_date.replace(/-/g, '')}`,
      `SUMMARY:${icsEscape(priorityTag + task.title)}`,
      ...(task.description ? [`DESCRIPTION:${icsEscape(task.description)}`] : []),
      `STATUS:${task.status === 'in_progress' ? 'CONFIRMED' : 'NEEDS-ACTION'}`,
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  // RFC 5545 requires CRLF line endings.
  return lines.join('\r\n') + '\r\n'
}

function icsTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

// Escapes the handful of characters ICS TEXT values require escaped —
// backslash first, so it doesn't double-escape the others.
function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function respondText(body: string, status = 200): Response {
  return new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } })
}
