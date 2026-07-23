import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

const TIERS = ['junior', 'intermediary', 'senior', 'principal_expert']

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

  let body: { query?: string }
  try { body = await req.json() }
  catch { return respond({ error: 'Invalid JSON body' }, 400) }
  const query = body.query?.trim()
  if (!query) return respond({ error: 'query is required' }, 400)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)

  // ── Step 1: interpret the natural-language query into structured
  //    criteria — Claude never sees or names actual experts here, only the
  //    controlled vocabulary and a list of open opportunities to resolve
  //    against, so it cannot hallucinate a match.
  const [sRes, lRes, gRes, dRes, oppRes] = await Promise.all([
    adminClient.from('sectors').select('name').order('sort_order'),
    adminClient.from('languages').select('name').order('name'),
    adminClient.from('geographies').select('country_name').order('country_name'),
    adminClient.from('donors').select('name').order('name'),
    adminClient.from('opportunities').select('id, title, organization').eq('status', 'open').order('created_at', { ascending: false }).limit(50),
  ])
  const sectors    = (sRes.data ?? []).map((r: any) => r.name)
  const languages   = (lRes.data ?? []).map((r: any) => r.name)
  const geographies = (gRes.data ?? []).map((r: any) => r.country_name)
  const donors      = (dRes.data ?? []).map((r: any) => r.name)
  const openOpps    = oppRes.data ?? []

  let criteria: any
  try {
    criteria = await interpretQuery(apiKey, query, sectors, languages, geographies, donors, openOpps)
  } catch (err) {
    return respond({ error: err instanceof Error ? err.message : 'Could not interpret query' }, 502)
  }

  const topN = Math.min(Math.max(1, Number(criteria.top_n) || 5), 20)

  // ── Step 2: deterministic retrieval — reuse already-computed match
  //    scores if the query resolved to a real opportunity, otherwise a
  //    transparent relevance-count filter over the extracted criteria.
  let results: any[] = []
  let matchedOpportunity: { id: string; title: string } | null = null

  if (criteria.opportunity_id) {
    const opp = openOpps.find((o: any) => o.id === criteria.opportunity_id)
    if (opp) {
      matchedOpportunity = { id: opp.id, title: opp.title }
      const { data: matches } = await adminClient
        .from('opportunity_expert_matches')
        .select('match_score, score_breakdown, experts(id, full_name, title, seniority_tier)')
        .eq('opportunity_id', opp.id)
        .is('opportunity_position_id', null)
        .order('match_score', { ascending: false })
        .limit(topN)
      results = (matches ?? []).map((m: any) => ({
        expert_id: m.experts?.id, full_name: m.experts?.full_name, title: m.experts?.title,
        seniority_tier: m.experts?.seniority_tier, score: m.match_score, basis: 'Computed match score',
      }))
    }
  }

  if (results.length === 0) {
    results = await filterSearch(adminClient, criteria, topN)
  }

  return respond({
    success: true,
    interpretation: criteria.interpretation_summary ?? query,
    opportunity: matchedOpportunity,
    used_computed_matches: results.length > 0 && !!matchedOpportunity && results[0]?.basis === 'Computed match score',
    results,
  })
})

async function interpretQuery(
  apiKey: string, query: string, sectors: string[], languages: string[], geographies: string[],
  donors: string[], openOpps: { id: string; title: string; organization: string }[],
): Promise<any> {
  const prompt = `You are the query interpreter for "Ask ACSD Intelligence", a natural-language search over ACSD's expert roster. Parse the admin's question below into structured search criteria. Return ONLY a valid JSON object (no markdown, no explanation):

{
  "opportunity_id": "if the question references a specific open opportunity from the list below (e.g. by donor name, title keyword, or 'this opportunity'), the matching id, else null",
  "sectors": ["names from the Sectors list below matching the query's intent, or []"],
  "languages": ["names from the Languages list below, or []"],
  "geographies": ["names from the Geographies list below, or []"],
  "donors": ["names from the Donors list below, or []"],
  "seniority_tiers": ["any of junior, intermediary, senior, principal_expert mentioned or implied, or []"],
  "top_n": "integer — how many results were requested, default 5",
  "interpretation_summary": "one sentence restating what you understood the admin is asking for, in the same language as the question"
}

Only use values from the controlled lists below — do not invent sector/language/geography/donor names outside these lists.

Question: "${query}"

Open opportunities (id — title — organization):
${openOpps.map(o => `${o.id} — ${o.title} — ${o.organization}`).join('\n') || 'None currently open.'}

Sectors: ${sectors.join(', ')}
Languages: ${languages.join(', ')}
Geographies: ${geographies.join(', ')}
Donors: ${donors.join(', ')}

Return ONLY the JSON object.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`Claude API error (${res.status})`)

  const data = await res.json()
  const rawText = extractText(data.content)
  const jsonStr = extractJsonObject(rawText)
  if (!jsonStr) {
    console.error('[ask-acsd-intelligence] no balanced JSON object found', rawText.slice(0, 1000))
    throw new Error('AI did not return structured data — try rephrasing the question')
  }
  try {
    return JSON.parse(jsonStr)
  } catch (err) {
    console.error('[ask-acsd-intelligence] failed to parse JSON', err instanceof Error ? err.message : err, jsonStr.slice(0, 1000))
    throw new Error('Could not parse AI response as JSON')
  }
}

// Transparent relevance-count filter: for each expert, count how many of the
// extracted criteria they actually satisfy against real profile data, and
// rank by that count. No AI involved in scoring — same "AI interprets,
// code retrieves" split used by the matching engine.
async function filterSearch(adminClient: any, criteria: any, topN: number): Promise<any[]> {
  const { data: experts } = await adminClient
    .from('experts')
    .select(`
      id, full_name, title, seniority_tier, years_experience, is_active,
      expert_sectors(sectors(name)),
      expert_languages(languages(name)),
      expert_geographies(geographies(country_name)),
      expert_donor_experience(donors(name))
    `)
    .eq('is_active', true)

  const wantSectors    = new Set((criteria.sectors ?? []).map((s: string) => s.toLowerCase()))
  const wantLanguages   = new Set((criteria.languages ?? []).map((s: string) => s.toLowerCase()))
  const wantGeographies = new Set((criteria.geographies ?? []).map((s: string) => s.toLowerCase()))
  const wantDonors      = new Set((criteria.donors ?? []).map((s: string) => s.toLowerCase()))
  const wantTiers       = new Set(criteria.seniority_tiers ?? [])
  const totalCriteria = wantSectors.size + wantLanguages.size + wantGeographies.size + wantDonors.size + wantTiers.size

  const scored = (experts ?? []).map((e: any) => {
    const expertSectors    = (e.expert_sectors ?? []).map((s: any) => s.sectors?.name?.toLowerCase()).filter(Boolean)
    const expertLanguages   = (e.expert_languages ?? []).map((l: any) => l.languages?.name?.toLowerCase()).filter(Boolean)
    const expertGeographies = (e.expert_geographies ?? []).map((g: any) => g.geographies?.country_name?.toLowerCase()).filter(Boolean)
    const expertDonors      = (e.expert_donor_experience ?? []).map((d: any) => d.donors?.name?.toLowerCase()).filter(Boolean)

    const matchedBasis: string[] = []
    let hits = 0
    if (wantSectors.size && expertSectors.some((s: string) => wantSectors.has(s))) { hits++; matchedBasis.push('Sector') }
    if (wantLanguages.size && expertLanguages.some((l: string) => wantLanguages.has(l))) { hits++; matchedBasis.push('Language') }
    if (wantGeographies.size && expertGeographies.some((g: string) => wantGeographies.has(g))) { hits++; matchedBasis.push('Geography') }
    if (wantDonors.size && expertDonors.some((d: string) => wantDonors.has(d))) { hits++; matchedBasis.push('Donor experience') }
    if (wantTiers.size && wantTiers.has(e.seniority_tier)) { hits++; matchedBasis.push('Seniority') }

    return { e, hits, matchedBasis }
  })

  // If no criteria were extracted at all, fall back to seniority/experience
  // ranking rather than returning an arbitrary/empty list.
  const ranked = totalCriteria === 0
    ? scored.sort((a, b) => (TIERS.indexOf(b.e.seniority_tier) - TIERS.indexOf(a.e.seniority_tier)) || (b.e.years_experience ?? 0) - (a.e.years_experience ?? 0))
    : scored.filter(s => s.hits > 0).sort((a, b) => b.hits - a.hits || (b.e.years_experience ?? 0) - (a.e.years_experience ?? 0))

  return ranked.slice(0, topN).map(({ e, hits, matchedBasis }) => ({
    expert_id: e.id, full_name: e.full_name, title: e.title, seniority_tier: e.seniority_tier,
    score: totalCriteria > 0 ? `${hits}/${totalCriteria} criteria` : null,
    basis: matchedBasis.length ? matchedBasis.join(', ') : (totalCriteria === 0 ? 'Ranked by seniority/experience (no specific criteria detected)' : 'No criteria matched'),
  }))
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const block = content.find((b: any) => b?.type === 'text')
  return block?.text ?? ''
}

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
  return null
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
