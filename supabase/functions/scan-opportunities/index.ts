import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

// ACSD's priority countries (ISO2), from the roster's own top-geographies —
// the World Bank procnotices API doesn't document a reliable multi-country
// filter, so this adapter loops one request per country rather than guess
// an unverified combined-filter syntax.
const TARGET_COUNTRIES: Record<string, string> = {
  BF: 'Burkina Faso', NE: 'Niger', ML: 'Mali', SN: 'Senegal', TD: 'Chad',
  GH: 'Ghana', BJ: 'Benin', GN: 'Guinea', CM: 'Cameroon', CI: "Cote d'Ivoire",
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return respond({ error: 'Missing Authorization header' }, 401)

  const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token)
  if (userErr || !user) return respond({ error: 'Unauthorized' }, 401)

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: roleRow } = await adminClient.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (roleRow?.role !== 'admin') return respond({ error: 'Forbidden — admin role required' }, 403)

  let body: { source_id?: string; source_ids?: string[]; all?: boolean }
  try { body = await req.json() }
  catch { return respond({ error: 'Invalid JSON body' }, 400) }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)

  // "all" scans every active API-automatable source; otherwise scan the
  // explicit id(s) given (source_id kept for backward compatibility with
  // single-source callers).
  let sources: any[]
  if (body.all) {
    const { data } = await adminClient.from('intelligence_sources')
      .select('*').eq('access_method', 'api').eq('active', true)
    sources = data ?? []
    if (sources.length === 0) return respond({ error: 'No active API-automatable sources found' }, 400)
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
    if (source.access_method !== 'api') {
      results.push({ source_id: source.id, source_name: source.name, status: 'skipped', message: `not API-automatable (access_method=${source.access_method}) — use the paste-intake flow` })
      continue
    }
    try {
      if (source.name === 'World Bank Procurement Notices') {
        const summary = await scanWorldBank(adminClient, apiKey)
        totals.new_count += summary.new_count
        totals.go += summary.go
        totals.a_etudier += summary.a_etudier
        totals.veille += summary.veille
        totals.rejet += summary.rejet
        results.push({ source_id: source.id, source_name: source.name, status: 'ok', new_count: summary.new_count })
      } else {
        results.push({ source_id: source.id, source_name: source.name, status: 'skipped', message: 'no automated adapter implemented yet' })
      }
    } catch (err) {
      results.push({ source_id: source.id, source_name: source.name, status: 'error', message: err instanceof Error ? err.message : 'Scan failed' })
    }
  }

  return respond({ success: true, ...totals, results })
})

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
  submission_date?: string
  notice_text?: string
}

async function scanWorldBank(adminClient: any, apiKey: string) {
  // 1. Fetch candidate notices, one request per target country (see comment
  //    on TARGET_COUNTRIES above).
  const allNotices: WbNotice[] = []
  for (const code of Object.keys(TARGET_COUNTRIES)) {
    const url = `https://search.worldbank.org/api/procnotices?format=json&rows=25&countrycode_exact=${code}`
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const json = await res.json()
      const notices: WbNotice[] = json.procnotices ?? []
      allNotices.push(...notices)
    } catch (_) { /* one country failing shouldn't abort the whole scan */ }
  }

  // 2. Keep only recent, non-cancelled notices with a usable reference number,
  //    newest first (server-side sort params aren't reliably documented, so
  //    sort/filter here instead of trusting an unverified query string).
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 60)
  const candidates = allNotices
    .filter(n => n.bid_reference_no && n.notice_status !== 'Cancelled')
    .filter(n => !n.noticedate || new Date(n.noticedate) >= cutoff)
    .sort((a, b) => new Date(b.noticedate ?? 0).getTime() - new Date(a.noticedate ?? 0).getTime())

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
      deadline: notice.submission_date ? notice.submission_date.slice(0, 10) : null,
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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`Claude API error (${res.status})`)

  const data = await res.json()
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

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const block = content.find((b: any) => b?.type === 'text')
  return block?.text ?? ''
}

// A naive greedy regex (first "{" to last "}") breaks the moment Claude adds
// any trailing commentary containing a brace, and a non-greedy one breaks on
// nested objects (this schema has a nested strategic_score_breakdown). Scan
// from the first "{" and track brace depth (ignoring braces inside strings)
// to find the exact matching close brace instead.
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escapeNext = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escapeNext) { escapeNext = false; continue }
    if (ch === '\\') { escapeNext = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null // unbalanced — response was likely truncated
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
