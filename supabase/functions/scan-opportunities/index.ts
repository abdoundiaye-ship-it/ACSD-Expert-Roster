import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { respond } from '../_shared/respond.ts'
import { requireAdminOrServiceRole } from '../_shared/auth.ts'
import { callClaude, extractText, extractJsonObject } from '../_shared/claude.ts'
import { fetchWithTimeout } from '../_shared/http.ts'
import { CORS } from '../_shared/cors.ts'

// ACSD's priority countries (ISO2 kept only as loop keys), from the
// roster's own top-geographies. The WB procnotices API's documented
// `countrycode_exact` / `countryname_exact` params were confirmed against
// live responses (2026-08) to silently return the entire unfiltered
// ~400k-row global dataset regardless of value — `qterm` (free-text
// search) is the parameter that actually narrows results by country, so
// this adapter queries by country name via qterm and then re-checks
// project_ctry_name on the results rather than trusting a broken filter
// param or relevance ranking alone.
const TARGET_COUNTRIES: Record<string, string> = {
  BF: 'Burkina Faso', NE: 'Niger', ML: 'Mali', SN: 'Senegal', TD: 'Chad',
  GH: 'Ghana', BJ: 'Benin', GN: 'Guinea', CM: 'Cameroon', CI: "Cote d'Ivoire",
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const auth = await requireAdminOrServiceRole(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth

  // A scheduled pg_cron run (see migration 0011) authenticates as the
  // project's own service-role key rather than a user session — trusted
  // directly as a system caller by requireAdminOrServiceRole above.
  const triggeredBy: 'manual' | 'scheduled' = auth.isServiceRole ? 'scheduled' : 'manual'
  const triggeredByUserId: string | null = auth.isServiceRole ? null : auth.user.id

  let body: { source_id?: string; source_ids?: string[]; all?: boolean }
  try { body = await req.json() }
  catch { return respond({ error: 'Invalid JSON body' }, 400) }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    await logScanRun(adminClient, triggeredBy, triggeredByUserId, null, 'ANTHROPIC_API_KEY is not configured on this project')
    return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)
  }

  // "all" scans every active automatable source — api (named adapters
  // below) or rss (generic feed adapter) — this is what the scheduled job
  // always passes; otherwise scan the explicit id(s) given (source_id kept
  // for backward compatibility with single-source callers).
  let sources: any[]
  if (body.all) {
    const { data } = await adminClient.from('intelligence_sources')
      .select('*').in('access_method', ['api', 'rss']).eq('active', true)
    sources = data ?? []
    if (sources.length === 0) {
      await logScanRun(adminClient, triggeredBy, triggeredByUserId, null, 'No active automatable sources found')
      return respond({ error: 'No active automatable sources found' }, 400)
    }
  } else {
    const ids = [...new Set([...(body.source_ids ?? []), ...(body.source_id ? [body.source_id] : [])])]
    if (ids.length === 0) return respond({ error: 'source_id, source_ids, or all is required' }, 400)
    const { data } = await adminClient.from('intelligence_sources').select('*').in('id', ids)
    sources = data ?? []
    if (sources.length === 0) return respond({ error: 'Source(s) not found' }, 404)
  }

  const totals = { new_count: 0, go: 0, a_etudier: 0, veille: 0, rejet: 0 }
  const results: Array<{ source_id: string; source_name: string; status: 'ok' | 'skipped' | 'error'; message?: string; new_count?: number }> = []

  for (const source of sources) {
    if (source.access_method !== 'api' && source.access_method !== 'rss') {
      results.push({ source_id: source.id, source_name: source.name, status: 'skipped', message: `not automatable (access_method=${source.access_method}) — use the paste-intake flow` })
      continue
    }
    try {
      let summary: { new_count: number; go: number; a_etudier: number; veille: number; rejet: number }
      if (source.access_method === 'rss') {
        // Generic — works for any source tagged rss, unlike the api branch
        // below which needs a hand-written adapter per named source.
        summary = await scanRssSource(adminClient, apiKey, source)
      } else {
        const adapter = SOURCE_ADAPTERS[source.name]
        if (!adapter) {
          results.push({ source_id: source.id, source_name: source.name, status: 'skipped', message: 'no automated adapter implemented yet' })
          continue
        }
        summary = await adapter(adminClient, apiKey)
      }
      totals.new_count += summary.new_count
      totals.go += summary.go
      totals.a_etudier += summary.a_etudier
      totals.veille += summary.veille
      totals.rejet += summary.rejet
      results.push({ source_id: source.id, source_name: source.name, status: 'ok', new_count: summary.new_count })
    } catch (err) {
      results.push({ source_id: source.id, source_name: source.name, status: 'error', message: err instanceof Error ? err.message : 'Scan failed' })
    }
  }

  await logScanRun(adminClient, triggeredBy, triggeredByUserId, { ...totals, results }, null)
  if (totals.new_count > 0) {
    await notifyScanComplete(adminClient, triggeredBy, triggeredByUserId, totals)
  }
  return respond({ success: true, ...totals, results })
})

// A scan that found nothing new isn't worth interrupting anyone about —
// only notify when new_count > 0 (checked by the caller above).
async function notifyScanComplete(
  adminClient: any,
  triggeredBy: 'manual' | 'scheduled',
  triggeredByUserId: string | null,
  totals: { new_count: number; go: number; a_etudier: number; veille: number; rejet: number },
): Promise<void> {
  const title = 'Scan complete'
  const body = `${totals.new_count} new opportunit${totals.new_count === 1 ? 'y' : 'ies'} found — ${totals.go} GO, ${totals.a_etudier} À étudier, ${totals.veille} Veille, ${totals.rejet} Rejet (archived).`
  // Minute-granular timestamp keeps a genuine accidental double-invoke from
  // creating duplicates within the same run, without permanently blocking a
  // later, separate run from notifying again.
  const runStamp = new Date().toISOString().slice(0, 16)

  let recipientIds: string[] = []
  if (triggeredBy === 'manual' && triggeredByUserId) {
    recipientIds = [triggeredByUserId]
  } else {
    // A scheduled run has no single human trigger — notify every admin,
    // since the whole team benefits from knowing new opportunities landed.
    const { data: admins } = await adminClient.from('user_roles').select('user_id').eq('role', 'admin')
    recipientIds = (admins ?? []).map((r: { user_id: string }) => r.user_id)
  }
  if (recipientIds.length === 0) return

  const rows = recipientIds.map(uid => ({
    user_id: uid,
    type: 'scan_result',
    title,
    body,
    link_url: 'opportunities.html',
    dedupe_key: `scan_result:${triggeredBy}:${runStamp}:${uid}`,
  }))
  const { error } = await adminClient.from('notifications').insert(rows)
  if (error && error.code !== '23505') {
    console.error('[scan-opportunities] failed to insert notifications', error.message)
  }
}

// Every run — manual button click or scheduled pg_cron job — is logged so
// admins can see what the automated daily scan actually did without
// needing to be watching a toast notification when it fires.
async function logScanRun(
  adminClient: any,
  triggeredBy: 'manual' | 'scheduled',
  triggeredByUserId: string | null,
  summary: { new_count: number; go: number; a_etudier: number; veille: number; rejet: number; results: unknown[] } | null,
  error: string | null,
): Promise<void> {
  const { error: insErr } = await adminClient.from('scan_runs').insert({
    triggered_by: triggeredBy,
    triggered_by_user_id: triggeredByUserId,
    new_count: summary?.new_count ?? 0,
    go_count: summary?.go ?? 0,
    a_etudier_count: summary?.a_etudier ?? 0,
    veille_count: summary?.veille ?? 0,
    rejet_count: summary?.rejet ?? 0,
    results: summary?.results ?? null,
    error,
  })
  if (insErr) console.error('[scan-opportunities] failed to log scan_runs row', insErr.message)
}

// Lookup by intelligence_sources.name, used only for access_method='api'
// sources — each one has a bespoke adapter because each API has its own
// request shape and response fields (see World Bank vs. TED below).
// access_method='rss' sources don't go through this table at all — they
// all share the single generic scanRssSource adapter further down, since
// RSS/Atom is a standard enough format that one parser covers any feed.
// Adding a new *API* source is a new entry here (plus its own scanX
// function), not a new branch in the dispatch loop above.
const SOURCE_ADAPTERS: Record<string, (adminClient: any, apiKey: string) => Promise<{
  new_count: number; go: number; a_etudier: number; veille: number; rejet: number
}>> = {
  'World Bank Procurement Notices': scanWorldBank,
  'Union européenne (TED / EuropeAid-FPI)': scanTed,
  'UNDP Procurement': scanUndp,
}

// ── World Bank adapter ───────────────────────────────────────────────────────

interface WbNotice {
  id: string
  notice_type?: string
  notice_status?: string
  noticedate?: string
  project_ctry_name?: string
  project_name?: string
  bid_reference_no?: string
  bid_description?: string
  submission_deadline_date?: string
  notice_text?: string
}

async function scanWorldBank(adminClient: any, apiKey: string) {
  // 1. Fetch candidate notices, one qterm (free-text) request per target
  //    country name — see comment on TARGET_COUNTRIES above for why qterm
  //    is used instead of the documented-but-broken exact-match params.
  const allNotices: WbNotice[] = []
  for (const countryName of Object.values(TARGET_COUNTRIES)) {
    const url = `https://search.worldbank.org/api/procnotices?format=json&rows=25&qterm=${encodeURIComponent(countryName)}`
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 15_000 })
      if (!res.ok) { console.error(`[scan-opportunities] World Bank fetch failed for ${countryName}: HTTP ${res.status}`); continue }
      const json = await res.json()
      const notices: WbNotice[] = (json.procnotices ?? [])
        // qterm is free-text search, not an exact filter — re-check the
        // actual country field rather than trusting relevance ranking.
        .filter((n: WbNotice) => n.project_ctry_name === countryName)
      allNotices.push(...notices)
    } catch (err) {
      // one country failing shouldn't abort the whole scan — the other 9
      // still run — but log it so a real, ongoing failure isn't invisible.
      console.error(`[scan-opportunities] World Bank fetch errored for ${countryName}:`, err instanceof Error ? err.message : err)
    }
  }

  // 2. Keep only Published notices that actually carry a submission
  //    deadline and haven't already passed it — this naturally excludes
  //    Contract Award / Draft / Cancelled notices, which structurally have
  //    no submission deadline to give (they aren't open, biddable
  //    opportunities). Soonest deadline first.
  const today = new Date().toISOString().slice(0, 10)
  const candidates = allNotices
    .filter(n => n.bid_reference_no && n.notice_status === 'Published' && n.submission_deadline_date)
    .filter(n => n.submission_deadline_date!.slice(0, 10) >= today)
    .sort((a, b) => new Date(a.submission_deadline_date!).getTime() - new Date(b.submission_deadline_date!).getTime())

  // 3. Dedupe against opportunities already in the system.
  const refNumbers = [...new Set(candidates.map(n => n.bid_reference_no!))]
  const { data: existingRows } = refNumbers.length
    ? await adminClient.from('opportunities').select('reference_number').in('reference_number', refNumbers)
    : { data: [] }
  const existingRefs = new Set((existingRows ?? []).map((r: any) => r.reference_number))
  const newNotices = candidates.filter(n => !existingRefs.has(n.bid_reference_no)).slice(0, 20)

  // 4. Score and insert each new notice.
  const acsdProfile = await computeAcsdProfile(adminClient)
  const { data: donorRow } = await adminClient.from('donors').select('id').eq('name', 'World Bank').maybeSingle()
  const { data: geoRows } = await adminClient.from('geographies').select('id, country_name')

  const counts = { go: 0, a_etudier: 0, veille: 0, rejet: 0 }
  let newCount = 0

  for (const notice of newNotices) {
    const noticeText = [notice.project_name, notice.bid_description, notice.notice_text].filter(Boolean).join('\n\n')
    if (!noticeText.trim()) continue

    let scored: { strategic_score: number; strategic_score_breakdown: Record<string, number>; strategic_score_confidence: string; strategic_score_rationale: string; summary: string }
    try {
      scored = await scoreNoticeText(apiKey, acsdProfile, noticeText)
    } catch (_) {
      continue // skip notices Claude fails to score rather than failing the whole scan
    }

    const status = scored.strategic_score < 50 ? 'archived' : 'open'
    const opportunityType = /expression of interest/i.test(notice.notice_type ?? '') ? 'EOI' : 'RFP'
    const countryMatch = (geoRows ?? []).find((g: any) =>
      g.country_name.toLowerCase() === (notice.project_ctry_name ?? '').toLowerCase())

    const { error: insErr } = await adminClient.from('opportunities').insert({
      title: notice.project_name || notice.bid_description?.slice(0, 200) || 'World Bank Procurement Notice',
      reference_number: notice.bid_reference_no,
      organization: 'World Bank',
      donor_id: donorRow?.id ?? null,
      primary_country_id: countryMatch?.id ?? null,
      opportunity_type: opportunityType,
      deadline: notice.submission_deadline_date!.slice(0, 10),
      summary: scored.summary || notice.bid_description || null,
      source: 'api_scan',
      status,
      strategic_score: scored.strategic_score,
      strategic_score_breakdown: scored.strategic_score_breakdown,
      strategic_score_confidence: scored.strategic_score_confidence,
      strategic_score_rationale: scored.strategic_score_rationale,
    })
    if (insErr) continue

    newCount++
    if (scored.strategic_score >= 85) counts.go++
    else if (scored.strategic_score >= 70) counts.a_etudier++
    else if (scored.strategic_score >= 50) counts.veille++
    else counts.rejet++
  }

  return { new_count: newCount, ...counts }
}

// ── TED (EU) adapter ─────────────────────────────────────────────────────────
// api.ted.europa.eu/v3/notices/search is free, public JSON with no auth wall
// — pilot-confirmed 2026-07-28 (see migration 0012). Unlike the World Bank
// API, TED documents a real structured filter on place-of-performance, so
// this adapter uses one combined query instead of looping per country.

const TED_TARGET_COUNTRIES: Record<string, string> = {
  BFA: 'Burkina Faso', NER: 'Niger', MLI: 'Mali', SEN: 'Senegal', TCD: 'Chad',
  GHA: 'Ghana', BEN: 'Benin', GIN: 'Guinea', CMR: 'Cameroon', CIV: "Cote d'Ivoire",
}

interface TedNotice {
  'publication-number'?: string
  'notice-title'?: Record<string, string>
  'description-proc'?: Record<string, string>
  'publication-date'?: string
  'deadline-receipt-tender-date-lot'?: string | string[]
  'place-of-performance-country-proc'?: string[]
  'buyer-name'?: Record<string, string[]>
  'notice-type'?: string
}

// TED returns most text fields as { langCode: value }, English/French first
// where available — prefer those over an arbitrary language a French/English
// bilingual firm can't read.
function tedPickLang(obj?: Record<string, string> | Record<string, string[]>): string {
  if (!obj) return ''
  const val = (obj as any)['eng'] ?? (obj as any)['fra'] ?? Object.values(obj)[0]
  if (Array.isArray(val)) return val[0] ?? ''
  return val ?? ''
}

async function scanTed(adminClient: any, apiKey: string) {
  // 1. Fetch candidate notices in target countries, recent first.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 60)
  const cutoffStr = cutoff.toISOString().slice(0, 10).replace(/-/g, '')
  const countryList = Object.keys(TED_TARGET_COUNTRIES).join(' ')

  // No try/catch swallow here on purpose — a failed fetch (timeout, network
  // error, or a non-2xx response) throws and propagates up to this
  // function's caller in the dispatch loop, which already isolates
  // per-source failures (one source erroring doesn't abort the whole scan).
  // Silently treating a failure as "zero candidates found" previously made
  // a broken TED query indistinguishable from a genuinely quiet day.
  const res = await fetchWithTimeout('https://api.ted.europa.eu/v3/notices/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `place-of-performance-country-proc IN (${countryList}) AND PD>=${cutoffStr}`,
      fields: ['publication-number', 'notice-title', 'description-proc', 'publication-date',
               'deadline-receipt-tender-date-lot', 'place-of-performance-country-proc',
               'buyer-name', 'notice-type'],
      limit: 50,
      page: 1,
    }),
    timeoutMs: 20_000,
  })
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`TED API returned HTTP ${res.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ''}`)
  }
  const json = await res.json()
  const candidates: TedNotice[] = (json.notices ?? []).filter((n: TedNotice) =>
    n['publication-number'] && !/^can-/.test(n['notice-type'] ?? '')) // skip already-awarded contract notices

  // 2. Dedupe against opportunities already in the system.
  const refNumbers = [...new Set(candidates.map(n => n['publication-number']!))]
  const { data: existingRows } = refNumbers.length
    ? await adminClient.from('opportunities').select('reference_number').in('reference_number', refNumbers)
    : { data: [] }
  const existingRefs = new Set((existingRows ?? []).map((r: any) => r.reference_number))
  const newNotices = candidates.filter(n => !existingRefs.has(n['publication-number'])).slice(0, 20)

  // 3. Score and insert each new notice.
  const acsdProfile = await computeAcsdProfile(adminClient)
  const { data: donorRows } = await adminClient.from('donors').select('id, name')
  const { data: geoRows } = await adminClient.from('geographies').select('id, country_name')

  const counts = { go: 0, a_etudier: 0, veille: 0, rejet: 0 }
  let newCount = 0

  for (const notice of newNotices) {
    const title = tedPickLang(notice['notice-title'])
    const description = tedPickLang(notice['description-proc'])
    const noticeText = [title, description].filter(Boolean).join('\n\n')
    if (!noticeText.trim()) continue

    let scored: { strategic_score: number; strategic_score_breakdown: Record<string, number>; strategic_score_confidence: string; strategic_score_rationale: string; summary: string }
    try {
      scored = await scoreNoticeText(apiKey, acsdProfile, noticeText)
    } catch (_) {
      continue // skip notices Claude fails to score rather than failing the whole scan
    }

    const status = scored.strategic_score < 50 ? 'archived' : 'open'
    const buyerName = tedPickLang(notice['buyer-name'])
    const countryCode = (notice['place-of-performance-country-proc'] ?? []).find(c => TED_TARGET_COUNTRIES[c])
    const countryMatch = countryCode
      ? (geoRows ?? []).find((g: any) => g.country_name === TED_TARGET_COUNTRIES[countryCode])
      : null
    // Loose match — buyers are named things like "Deutsche Gesellschaft für
    // Internationale Zusammenarbeit (GIZ) GmbH", so exact-match against the
    // donors table would rarely hit; substring is deliberately permissive.
    const donorMatch = buyerName
      ? (donorRows ?? []).find((d: any) => buyerName.toLowerCase().includes(String(d.name).toLowerCase()))
      : null
    const deadlineRaw = Array.isArray(notice['deadline-receipt-tender-date-lot'])
      ? notice['deadline-receipt-tender-date-lot'][0]
      : notice['deadline-receipt-tender-date-lot']

    const { error: insErr } = await adminClient.from('opportunities').insert({
      title: title || `TED Notice ${notice['publication-number']}`,
      reference_number: notice['publication-number'],
      organization: buyerName || 'Unknown (TED)',
      donor_id: donorMatch?.id ?? null,
      primary_country_id: countryMatch?.id ?? null,
      opportunity_type: 'RFP',
      deadline: deadlineRaw ? deadlineRaw.slice(0, 10) : null,
      summary: scored.summary || description || null,
      source: 'api_scan',
      status,
      strategic_score: scored.strategic_score,
      strategic_score_breakdown: scored.strategic_score_breakdown,
      strategic_score_confidence: scored.strategic_score_confidence,
      strategic_score_rationale: scored.strategic_score_rationale,
    })
    if (insErr) continue

    newCount++
    if (scored.strategic_score >= 85) counts.go++
    else if (scored.strategic_score >= 70) counts.a_etudier++
    else if (scored.strategic_score >= 50) counts.veille++
    else counts.rejet++
  }

  return { new_count: newCount, ...counts }
}

// ── UNDP adapter (HTML scrape — no feed/API exists, but the listing page
//    itself is server-rendered with a clean, consistent structure) ───────────
// procurement-notices.undp.org has no RSS/API of its own (confirmed live,
// 2026-08-04 source pilot — see migration 0024), but its notice list is
// plain server-rendered HTML: each notice is an <a href="view_negotiation
// .cfm?nego_id=NNNNN" class="vacanciesTableLink ..."> wrapping a fixed set
// of labeled cells (Title, Ref No, UNDP Office/Country, Process, Deadline,
// Posted). Deadline is a real structured date ("13-Aug-26"), unlike a
// generic RSS description — good enough to trust the same way WB/TED's own
// structured deadline fields are trusted.

interface UndpNotice {
  negoId: string
  title?: string
  refNo?: string
  officeCountry?: string
  process?: string
  deadline?: string
}

const UNDP_MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

function parseUndpDate(s: string): string | null {
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})/)
  if (!m) return null
  const mon = UNDP_MONTHS[m[2]]
  if (!mon) return null
  return `20${m[3]}-${mon}-${m[1].padStart(2, '0')}`
}

function parseUndpNotices(html: string): UndpNotice[] {
  const notices: UndpNotice[] = []
  const blocks = html.matchAll(/<a\s+href="view_negotiation\.cfm\?nego_id=(\d+)"[^>]*class="vacanciesTableLink[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)
  for (const block of blocks) {
    const negoId = block[1]
    const body = block[2]
    const cells: Record<string, string> = {}
    for (const cell of body.matchAll(/<div class="vacanciesTable__cell__label">\s*([^<]+?)\s*<\/div>\s*<span>([\s\S]*?)<\/span>/gi)) {
      const label = cell[1].trim().toLowerCase()
      const value = cell[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      cells[label] = value
    }
    notices.push({
      negoId,
      title: cells['title'],
      refNo: cells['ref no'],
      officeCountry: cells['undp office/country'],
      process: cells['process'],
      deadline: cells['deadline'],
    })
  }
  return notices
}

async function scanUndp(adminClient: any, apiKey: string) {
  const res = await fetchWithTimeout('https://procurement-notices.undp.org/', { timeoutMs: 20_000 })
  if (!res.ok) throw new Error(`UNDP procurement page returned HTTP ${res.status}`)
  const html = await res.text()
  const parsed = parseUndpNotices(html)
  if (parsed.length === 0) {
    throw new Error('Fetched the page but found no vacanciesTableLink notices — the site\'s markup may have changed.')
  }

  // This is UNDP's single global notice board (~500+ notices across ~150
  // country offices at any time, confirmed live 2026-08) — its own country
  // "filter" on the live site is client-side JS over this same full list,
  // not a server-side query param (every param name tried returned the
  // identical unfiltered count), so target-country filtering has to happen
  // here, the same way scanWorldBank/scanTed filter their own results.
  // Only genuinely open, in-target-country notices: real ref number,
  // title, a future parseable deadline, and an office in a target country.
  const targetCountryNames = new Set(Object.values(TARGET_COUNTRIES).map(c => c.toLowerCase()))
  const today = new Date().toISOString().slice(0, 10)
  const candidates = parsed
    .map(n => ({ ...n, deadlineIso: n.deadline ? parseUndpDate(n.deadline) : null }))
    .filter(n => n.refNo && n.title && n.deadlineIso && n.deadlineIso >= today)
    .filter(n => {
      const countryName = n.officeCountry?.split('/').pop()?.trim().toLowerCase()
      return !!countryName && targetCountryNames.has(countryName)
    })
    .sort((a, b) => a.deadlineIso!.localeCompare(b.deadlineIso!))

  // Dedupe against opportunities already in the system.
  const refNumbers = [...new Set(candidates.map(n => n.refNo!))]
  const { data: existingRows } = refNumbers.length
    ? await adminClient.from('opportunities').select('reference_number').in('reference_number', refNumbers)
    : { data: [] }
  const existingRefs = new Set((existingRows ?? []).map((r: any) => r.reference_number))
  const newNotices = candidates.filter(n => !existingRefs.has(n.refNo)).slice(0, 20)

  const acsdProfile = await computeAcsdProfile(adminClient)
  const { data: geoRows } = await adminClient.from('geographies').select('id, country_name')
  const counts = { go: 0, a_etudier: 0, veille: 0, rejet: 0 }
  let newCount = 0

  for (const notice of newNotices) {
    const noticeText = [notice.title, notice.process, notice.officeCountry].filter(Boolean).join('\n')
    if (!noticeText.trim()) continue

    let scored: { strategic_score: number; strategic_score_breakdown: Record<string, number>; strategic_score_confidence: string; strategic_score_rationale: string; summary: string }
    try {
      scored = await scoreNoticeText(apiKey, acsdProfile, noticeText)
    } catch (_) {
      continue // skip notices Claude fails to score rather than failing the whole scan
    }

    const status = scored.strategic_score < 50 ? 'archived' : 'open'
    const opportunityType = /RFP|request for proposal/i.test(notice.process ?? '') ? 'RFP'
      : /EOI|expression of interest/i.test(notice.process ?? '') ? 'EOI'
      : /RFQ|request for quotation/i.test(notice.process ?? '') ? 'RFQ'
      : 'RFP'
    // "UNDP-ALB/ALBANIA" -> "ALBANIA"
    const countryName = notice.officeCountry?.split('/').pop()?.trim()
    const countryMatch = countryName
      ? (geoRows ?? []).find((g: any) => g.country_name.toLowerCase() === countryName.toLowerCase())
      : null

    const { error: insErr } = await adminClient.from('opportunities').insert({
      title: notice.title!.slice(0, 200),
      reference_number: notice.refNo,
      organization: 'UNDP',
      primary_country_id: countryMatch?.id ?? null,
      opportunity_type: opportunityType,
      deadline: notice.deadlineIso,
      summary: scored.summary || noticeText || null,
      source: 'api_scan',
      status,
      strategic_score: scored.strategic_score,
      strategic_score_breakdown: scored.strategic_score_breakdown,
      strategic_score_confidence: scored.strategic_score_confidence,
      strategic_score_rationale: scored.strategic_score_rationale,
    })
    if (insErr) continue

    newCount++
    if (scored.strategic_score >= 85) counts.go++
    else if (scored.strategic_score >= 70) counts.a_etudier++
    else if (scored.strategic_score >= 50) counts.veille++
    else counts.rejet++
  }

  return { new_count: newCount, ...counts }
}

// ── Generic RSS/Atom adapter ─────────────────────────────────────────────────
// Unlike World Bank/TED, this isn't per-source — it works for any source
// tagged access_method='rss', using that source's own portal_url as the
// feed URL (must be the actual .xml feed, not a portal homepage). A
// hand-rolled regex parser rather than a library: RSS 2.0 <item> and Atom
// <entry> cover the vast majority of real feeds, and this avoids pulling in
// a full XML/DOM dependency for what's structurally a flat list of
// title/link/description/date per entry.

interface FeedItem {
  title: string
  link: string
  description: string
  guid: string
}

function scanRssFeedXml(xml: string): FeedItem[] {
  const items: FeedItem[] = []

  const rssBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []
  for (const block of rssBlocks) {
    const link = extractTag(block, 'link')
    items.push({
      title: extractTag(block, 'title'),
      link,
      description: extractTag(block, 'content:encoded') || extractTag(block, 'description'),
      guid: extractTag(block, 'guid') || link,
    })
  }

  if (items.length === 0) {
    // Not RSS 2.0 — try Atom.
    const atomBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []
    for (const block of atomBlocks) {
      const link = extractAtomLink(block)
      items.push({
        title: extractTag(block, 'title'),
        link,
        description: extractTag(block, 'summary') || extractTag(block, 'content'),
        guid: extractTag(block, 'id') || link,
      })
    }
  }

  return items.filter(i => i.title && i.link)
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!m) return ''
  return decodeXmlEntities(stripCdata(m[1]).trim())
}

function extractAtomLink(block: string): string {
  // Atom <link> is self-closing with an href attribute, not a text node —
  // prefer rel="alternate" (the human-readable page) when more than one is present.
  const links = [...block.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/gi)]
  const alt = links.find(m => /rel=["']alternate["']/i.test(m[0]))
  return (alt ?? links[0])?.[1] ?? ''
}

function stripCdata(s: string): string {
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  return m ? m[1] : s
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function scanRssSource(
  adminClient: any, apiKey: string, source: { id: string; name: string; portal_url: string | null },
) {
  if (!source.portal_url) {
    throw new Error('No Portal URL configured for this source — set it to the feed\'s actual .xml/.rss URL in Intelligence Sources.')
  }

  const res = await fetchWithTimeout(source.portal_url, { timeoutMs: 15_000 })
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`)
  const xml = await res.text()
  const items = scanRssFeedXml(xml).slice(0, 30)
  if (items.length === 0) {
    throw new Error('Fetched the URL but found no RSS <item> or Atom <entry> elements — confirm the Portal URL points at the feed XML, not the site homepage.')
  }

  // 1. Dedupe against opportunities already in the system. Generic feeds
  //    don't carry a solicitation reference number the way WB/TED do, so
  //    the item's own guid (falling back to its link) is used instead —
  //    both are expected to be stable and unique per entry.
  const refs = [...new Set(items.map(i => i.guid))]
  const { data: existingRows } = refs.length
    ? await adminClient.from('opportunities').select('reference_number').in('reference_number', refs)
    : { data: [] }
  const existingRefs = new Set((existingRows ?? []).map((r: any) => r.reference_number))
  const newItems = items.filter(i => !existingRefs.has(i.guid)).slice(0, 20)

  // 2. Score and insert each new item.
  const acsdProfile = await computeAcsdProfile(adminClient)
  const counts = { go: 0, a_etudier: 0, veille: 0, rejet: 0 }
  let newCount = 0

  for (const item of newItems) {
    const description = stripHtml(item.description)
    const noticeText = [item.title, description].filter(Boolean).join('\n\n')
    if (!noticeText.trim()) continue

    let scored: { strategic_score: number; strategic_score_breakdown: Record<string, number>; strategic_score_confidence: string; strategic_score_rationale: string; summary: string }
    try {
      scored = await scoreNoticeText(apiKey, acsdProfile, noticeText)
    } catch (_) {
      continue // skip items Claude fails to score rather than failing the whole scan
    }

    const status = scored.strategic_score < 50 ? 'archived' : 'open'

    const { error: insErr } = await adminClient.from('opportunities').insert({
      title: item.title.slice(0, 200),
      reference_number: item.guid,
      organization: source.name,
      opportunity_type: 'RFP',
      // Generic RSS/Atom has no standard deadline field the way WB/TED's
      // structured APIs do — left null rather than guessed from freeform
      // text. Review the item and set it manually on the Overview tab.
      deadline: null,
      summary: scored.summary || description || null,
      source: 'api_scan',
      status,
      strategic_score: scored.strategic_score,
      strategic_score_breakdown: scored.strategic_score_breakdown,
      strategic_score_confidence: scored.strategic_score_confidence,
      strategic_score_rationale: scored.strategic_score_rationale,
    })
    if (insErr) continue

    newCount++
    if (scored.strategic_score >= 85) counts.go++
    else if (scored.strategic_score >= 70) counts.a_etudier++
    else if (scored.strategic_score >= 50) counts.veille++
    else counts.rejet++
  }

  return { new_count: newCount, ...counts }
}

// ── Scoring (short procurement-notice text — simplified vs. analyze-tor's
//    full-document version, same rubric and cap logic) ────────────────────

async function scoreNoticeText(apiKey: string, acsdProfile: string, noticeText: string): Promise<{
  strategic_score: number
  strategic_score_breakdown: Record<string, number>
  strategic_score_confidence: string
  strategic_score_rationale: string
  summary: string
}> {
  const prompt = `Tu es analyste senior en veille et qualification d'appels d'offres pour ACSD, un cabinet de conseil ouest-africain.

PROFIL ACSD :
${acsdProfile}

Évalue cet avis de marché (notice de procurement, extrait brut ci-dessous) et retourne UNIQUEMENT un objet JSON valide :

{
  "summary": "2-3 sentence plain-language summary of what this assignment/procurement is about",
  "strategic_score_breakdown": {
    "alignement_thematique": "integer 0-30",
    "adequation_geographique": "integer 0-15",
    "eligibilite_conformite": "integer 0-20",
    "valeur_strategique": "integer 0-20",
    "faisabilite_operationnelle": "integer 0-15"
  },
  "has_blocking_eligibility_issue": "boolean",
  "source_fully_read": "boolean — true if this notice text was substantive enough to judge confidently, false if too sparse/fragmentary",
  "strategic_score_rationale": "2-3 phrases factuelles en français"
}

Notice text:
---
${noticeText.slice(0, 8000)}
---

Return ONLY the JSON object.`

  // Shorter timeout/fewer retries than the default — this runs up to ~40
  // times in one scan (up to 20 notices × 2 source adapters), and a single
  // slow/failed notice should be skipped (see the per-notice try/catch at
  // each call site) rather than let one call eat the default 60s budget
  // and stall the whole scan.
  const data = await callClaude({
    apiKey, model: 'claude-sonnet-5', maxTokens: 1200,
    messages: [{ role: 'user', content: prompt }],
    timeoutMs: 25_000, retries: 1,
  })
  const rawText = extractText(data.content)
  const jsonStr = extractJsonObject(rawText)
  if (!jsonStr) {
    console.error('[scan-opportunities] no balanced JSON object found', rawText.slice(0, 1000))
    throw new Error('No JSON in Claude response')
  }

  let extracted: any
  try {
    extracted = JSON.parse(jsonStr)
  } catch (err) {
    console.error('[scan-opportunities] failed to parse JSON', err instanceof Error ? err.message : err, jsonStr.slice(0, 1000))
    throw new Error('Could not parse Claude response as JSON')
  }
  applyScoreCaps(extracted)
  return extracted
}

function applyScoreCaps(extracted: Record<string, any>): void {
  const breakdown = extracted.strategic_score_breakdown as Record<string, number> | undefined
  let total = breakdown ? Object.values(breakdown).reduce((sum: number, v) => sum + (Number(v) || 0), 0) : 0
  let confidence: 'confirmed' | 'to_confirm' = 'confirmed'
  if (extracted.has_blocking_eligibility_issue === true) total = Math.min(total, 49)
  if (extracted.source_fully_read === false) { total = Math.min(total, 84); confidence = 'to_confirm' }
  extracted.strategic_score = Math.round(Math.max(0, Math.min(100, total)))
  extracted.strategic_score_confidence = confidence
}

// Computed live from the actual roster, same approach as analyze-tor.
async function computeAcsdProfile(adminClient: any): Promise<string> {
  const [sectorRes, donorRes, geoRes] = await Promise.all([
    adminClient.from('expert_sectors').select('sectors(name)'),
    adminClient.from('expert_donor_experience').select('donors(name)'),
    adminClient.from('expert_geographies').select('geographies(country_name)'),
  ])
  const topN = (rows: any[], pick: (r: any) => string | undefined, n: number): string[] => {
    const counts: Record<string, number> = {}
    for (const r of rows ?? []) {
      const name = pick(r)
      if (name) counts[name] = (counts[name] ?? 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name)
  }
  const topSectors     = topN(sectorRes.data ?? [], (r) => r.sectors?.name, 8)
  const topDonors      = topN(donorRes.data ?? [], (r) => r.donors?.name, 8)
  const topGeographies = topN(geoRes.data ?? [], (r) => r.geographies?.country_name, 10)

  return `ACSD — cabinet de conseil basé au Burkina Faso, spécialisé en management, transformation organisationnelle, gouvernance et développement institutionnel.
Secteurs dominants du vivier d'experts : ${topSectors.join(', ') || 'non disponible'}.
Bailleurs déjà servis : ${topDonors.join(', ') || 'non disponible'}.
Zones prioritaires : ${topGeographies.join(', ') || 'non disponible'} — UEMOA/CEDEAO en priorité.`
}

