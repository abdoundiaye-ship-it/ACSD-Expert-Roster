import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

const TIERS = ['junior', 'intermediary', 'senior', 'principal_expert']
const LANG_PROF_WEIGHT: Record<string, number> = { native: 1.0, fluent: 1.0, professional: 0.8, working: 0.5 }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  // ── Verify authenticated admin ───────────────────────────────────────────
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return respond({ error: 'Missing Authorization header' }, 401)

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token)
  if (userErr || !user) return respond({ error: 'Unauthorized' }, 401)

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: roleRow } = await adminClient
    .from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (roleRow?.role !== 'admin') return respond({ error: 'Forbidden — admin role required' }, 403)

  // ── Parse request ─────────────────────────────────────────────────────────
  let body: { opportunity_id?: string; opportunity_position_id?: string | null; top_n?: number; skip_justification?: boolean }
  try { body = await req.json() }
  catch { return respond({ error: 'Invalid JSON body' }, 400) }

  const opportunityId = body.opportunity_id
  const positionId = body.opportunity_position_id ?? null
  const topN = body.top_n ?? 10
  const skipJustification = body.skip_justification ?? false

  if (!opportunityId) return respond({ error: 'opportunity_id is required' }, 400)

  // ── Load opportunity + requirements ──────────────────────────────────────
  const { data: opportunity, error: oppErr } = await adminClient
    .from('opportunities')
    .select(`
      id, title, donor_id,
      opportunity_sectors(sector_id, importance),
      opportunity_languages(language_id),
      opportunity_geographies(geography_id),
      opportunity_activity_types(activity_type_id)
    `)
    .eq('id', opportunityId)
    .single()
  if (oppErr || !opportunity) return respond({ error: 'Opportunity not found' }, 404)

  let position: { id: string; work_order_role_id: number | null; required_seniority_tier: string | null } | null = null
  if (positionId) {
    const { data: posData, error: posErr } = await adminClient
      .from('opportunity_positions')
      .select('id, work_order_role_id, required_seniority_tier')
      .eq('id', positionId)
      .single()
    if (posErr || !posData) return respond({ error: 'Position not found' }, 404)
    position = posData
  }

  // ── Donor category map (for partial donor-experience credit) ────────────
  const { data: donorRows } = await adminClient.from('donors').select('id, category_id')
  const donorCategoryMap: Record<number, number> = {}
  ;(donorRows ?? []).forEach((d: { id: number; category_id: number }) => { donorCategoryMap[d.id] = d.category_id })
  const oppDonorCategory = opportunity.donor_id ? donorCategoryMap[opportunity.donor_id] : null

  // ── Load all active experts with their tagged profile data ──────────────
  const { data: experts, error: expErr } = await adminClient
    .from('experts')
    .select(`
      id, full_name, seniority_tier, years_experience, is_active,
      expert_sectors(sector_id, priority),
      expert_languages(language_id, proficiency),
      expert_geographies(geography_id),
      expert_donor_experience(donor_id),
      expert_activity_experience(activity_type_id),
      expert_role_fit(work_order_role_id)
    `)
    .eq('is_active', true)
  if (expErr) return respond({ error: expErr.message }, 500)

  const oppSectors    = opportunity.opportunity_sectors ?? []
  const oppLanguages   = (opportunity.opportunity_languages ?? []).map((r: { language_id: number }) => r.language_id)
  const oppGeographies = (opportunity.opportunity_geographies ?? []).map((r: { geography_id: number }) => r.geography_id)
  const oppActivities  = (opportunity.opportunity_activity_types ?? []).map((r: { activity_type_id: number }) => r.activity_type_id)

  const scored = (experts ?? []).map((expert: any) => {
    const { matchScore, breakdown } = scoreExpert(expert, {
      sectors: oppSectors, languages: oppLanguages, geographies: oppGeographies,
      activities: oppActivities, donorId: opportunity.donor_id, donorCategory: oppDonorCategory,
      donorCategoryMap,
    }, position)
    return { expert, matchScore, breakdown }
  })

  scored.sort((a, b) =>
    b.matchScore - a.matchScore ||
    (b.expert.years_experience ?? 0) - (a.expert.years_experience ?? 0) ||
    a.expert.full_name.localeCompare(b.expert.full_name))

  const now = new Date().toISOString()
  const topIds = new Set(scored.slice(0, topN).map(s => s.expert.id))

  // ── AI justification for the top N only ──────────────────────────────────
  // Done BEFORE the delete/insert pair below (not between them) so the two
  // writes land back-to-back — a multi-second gap here previously left a
  // window where an overlapping call (e.g. a second click, or a concurrent
  // no-AI recompute) could insert first and collide with this one.
  const justifications: Record<string, string> = {}
  if (!skipJustification && scored.length > 0) {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (apiKey) {
      try {
        const top = scored.filter(s => topIds.has(s.expert.id))
        const justificationText = await getJustifications(apiKey, opportunity.title, top)
        Object.assign(justifications, justificationText)
      } catch (err) {
        // Justification is a nice-to-have; scoring must not fail if it errors — but log it so it's diagnosable.
        console.error('[compute-matches] justification call threw', err instanceof Error ? err.message : err)
      }
    }
  }

  const rows = scored.map(s => ({
    opportunity_id: opportunityId,
    opportunity_position_id: positionId,
    expert_id: s.expert.id,
    match_score: s.matchScore,
    score_breakdown: s.breakdown,
    ai_justification: justifications[s.expert.id] ?? null,
    computed_at: now,
  }))

  // ── Recompute: clear old rows for this (opportunity, position) pair,
  //    then insert fresh ones. If an overlapping call still collides (23505
  //    unique violation), retry the pair once — by then the other call's
  //    write has settled and the retry succeeds cleanly.
  const writeRows = async () => {
    let delQuery = adminClient.from('opportunity_expert_matches').delete().eq('opportunity_id', opportunityId)
    delQuery = positionId ? delQuery.eq('opportunity_position_id', positionId) : delQuery.is('opportunity_position_id', null)
    await delQuery
    if (!rows.length) return null
    return (await adminClient.from('opportunity_expert_matches').insert(rows)).error
  }

  let insErr = await writeRows()
  if (insErr?.code === '23505') insErr = await writeRows()
  if (insErr) return respond({ error: insErr.message }, 500)

  return respond({
    success: true,
    computed_at: now,
    matches: scored.map(s => ({
      expert_id: s.expert.id,
      full_name: s.expert.full_name,
      seniority_tier: s.expert.seniority_tier,
      years_experience: s.expert.years_experience,
      match_score: s.matchScore,
      score_breakdown: s.breakdown,
      ai_justification: justifications[s.expert.id] ?? null,
    })),
  })
})

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreExpert(
  expert: any,
  opp: { sectors: { sector_id: number; importance: string }[]; languages: number[]; geographies: number[];
         activities: number[]; donorId: number | null; donorCategory: number | null; donorCategoryMap: Record<number, number> },
  position: { work_order_role_id: number | null; required_seniority_tier: string | null } | null,
) {
  const expertGeoIds       = new Set((expert.expert_geographies ?? []).map((g: any) => g.geography_id))
  const expertActivityIds  = new Set((expert.expert_activity_experience ?? []).map((a: any) => a.activity_type_id))
  const expertDonorIds     = new Set((expert.expert_donor_experience ?? []).map((d: any) => d.donor_id))
  const expertRoleFitIds   = new Set((expert.expert_role_fit ?? []).map((r: any) => r.work_order_role_id))

  // Sector fit (weight 30) — required=3x, preferred=1x; primary=1.0, secondary=0.6, absent=0
  let sector = 30
  if (opp.sectors.length > 0) {
    let weightSum = 0, matchSum = 0
    for (const os of opp.sectors) {
      const w = os.importance === 'required' ? 3 : 1
      weightSum += w
      const es = (expert.expert_sectors ?? []).find((s: any) => s.sector_id === os.sector_id)
      const m = es ? (es.priority === 'primary' ? 1.0 : 0.6) : 0
      matchSum += w * m
    }
    sector = weightSum > 0 ? (matchSum / weightSum) * 30 : 30
  }

  // Geography fit (weight 15) — overlap ratio
  let geography = 15
  if (opp.geographies.length > 0) {
    const matched = opp.geographies.filter(gid => expertGeoIds.has(gid)).length
    geography = (matched / opp.geographies.length) * 15
  }

  // Language fit (weight 15) — best proficiency per required language, averaged
  let language = 15
  if (opp.languages.length > 0) {
    const sum = opp.languages.reduce((acc, lid) => {
      const el = (expert.expert_languages ?? []).find((l: any) => l.language_id === lid)
      return acc + (el ? (LANG_PROF_WEIGHT[el.proficiency] ?? 0.5) : 0)
    }, 0)
    language = (sum / opp.languages.length) * 15
  }

  // Donor experience fit (weight 15) — exact=1.0, same category=0.4, none=0
  let donor = 15
  if (opp.donorId) {
    if (expertDonorIds.has(opp.donorId)) {
      donor = 15
    } else {
      const sameCategory = [...expertDonorIds].some(did => opp.donorCategoryMap[did as number] === opp.donorCategory)
      donor = sameCategory ? 6 : 0
    }
  }

  // Activity/deliverable fit (weight 10) — overlap ratio
  let activity = 10
  if (opp.activities.length > 0) {
    const matched = opp.activities.filter(aid => expertActivityIds.has(aid)).length
    activity = (matched / opp.activities.length) * 10
  }

  const breakdown: Record<string, number> = {
    sector: round2(sector), geography: round2(geography), language: round2(language),
    donor: round2(donor), activity: round2(activity),
  }

  let total: number
  if (position) {
    // Role & seniority fit (weight 15) — position-specific
    let roleSeniority = 0
    roleSeniority += position.work_order_role_id
      ? (expertRoleFitIds.has(position.work_order_role_id) ? 10 : 0)
      : 10
    if (position.required_seniority_tier) {
      const diff = Math.abs(TIERS.indexOf(expert.seniority_tier) - TIERS.indexOf(position.required_seniority_tier))
      roleSeniority += diff === 0 ? 5 : diff === 1 ? 2.5 : 0
    } else {
      roleSeniority += 5
    }
    breakdown.role_seniority = round2(roleSeniority)
    total = sector + geography + language + donor + activity + roleSeniority
  } else {
    // No position specified — rescale the 5 general dimensions (sum 85) to 100
    const scale = 100 / 85
    breakdown.sector = round2(sector * scale)
    breakdown.geography = round2(geography * scale)
    breakdown.language = round2(language * scale)
    breakdown.donor = round2(donor * scale)
    breakdown.activity = round2(activity * scale)
    total = (sector + geography + language + donor + activity) * scale
  }

  return { matchScore: round2(Math.min(100, Math.max(0, total))), breakdown }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── AI justification (top-N only, one batched call) ───────────────────────

async function getJustifications(
  apiKey: string, opportunityTitle: string,
  top: { expert: any; matchScore: number; breakdown: Record<string, number> }[],
): Promise<Record<string, string>> {
  const profile = top.map(t => ({
    expert_id: t.expert.id,
    full_name: t.expert.full_name,
    seniority_tier: t.expert.seniority_tier,
    years_experience: t.expert.years_experience,
    match_score: t.matchScore,
    score_breakdown: t.breakdown,
    sectors: (t.expert.expert_sectors ?? []).length,
    donor_experience_count: (t.expert.expert_donor_experience ?? []).length,
  }))

  const prompt = `You are writing short fit-justification paragraphs for a ranked shortlist of consultants against this opportunity: "${opportunityTitle}".

For each expert below, write ONE concise paragraph (2-3 sentences) explaining why they scored the way they did, based ONLY on the data given (match_score and score_breakdown, and counts of sectors/donor experience — do not invent specifics not present here). Return ONLY a JSON object mapping expert_id to the justification string, no markdown, no explanation:

${JSON.stringify(profile, null, 2)}

Return format: { "<expert_id>": "justification text", ... }`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    console.error('[getJustifications] Claude API error', res.status, (await res.text()).slice(0, 500))
    return {}
  }

  const data = await res.json()
  const rawText: string = extractText(data.content)
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error('[getJustifications] no JSON object found in Claude response', rawText.slice(0, 500))
    return {}
  }
  try {
    return JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error('[getJustifications] failed to parse JSON', err instanceof Error ? err.message : err, jsonMatch[0].slice(0, 500))
    return {}
  }
}

// Claude's content array isn't always [textBlock] — a leading non-text
// block (e.g. extended thinking) would silently produce an empty string
// if we blindly read content[0].text. Find the actual text block instead.
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const block = content.find((b: any) => b?.type === 'text')
  return block?.text ?? ''
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
