import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

  let body: { opportunity_id?: string }
  try { body = await req.json() }
  catch { return respond({ error: 'Invalid JSON body' }, 400) }
  if (!body.opportunity_id) return respond({ error: 'opportunity_id is required' }, 400)

  const { data: opportunity, error: oppErr } = await adminClient
    .from('opportunities')
    .select('id, title, organization, opportunity_type, deadline, strategic_score, strategic_score_breakdown, strategic_score_rationale, evaluation_criteria')
    .eq('id', body.opportunity_id)
    .single()
  if (oppErr || !opportunity) return respond({ error: 'Opportunity not found' }, 404)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)

  // Top matched candidates (bench strength/depth), regardless of position —
  // gives a sense of how deep ACSD's pool is for this opportunity even if
  // matching hasn't been run per-position yet.
  const { data: topMatches } = await adminClient
    .from('opportunity_expert_matches')
    .select('match_score, experts(full_name, seniority_tier)')
    .eq('opportunity_id', body.opportunity_id)
    .order('match_score', { ascending: false })
    .limit(10)

  // Actual assembled team (what's really been committed so far, not just candidates).
  const { data: selectedTeam } = await adminClient
    .from('opportunity_selected_experts')
    .select('assigned_role_title, status, experts(full_name, seniority_tier, years_experience)')
    .eq('opportunity_id', body.opportunity_id)

  const daysRemaining = opportunity.deadline
    ? Math.ceil((new Date(opportunity.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  const prompt = buildPrompt(opportunity, topMatches ?? [], selectedTeam ?? [], daysRemaining)

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!claudeRes.ok) {
    const errText = await claudeRes.text()
    return respond({ error: `Claude API error (${claudeRes.status}): ${errText.slice(0, 400)}` }, 502)
  }

  const claudeData = await claudeRes.json()
  const rawText = extractText(claudeData.content)
  const jsonStr = extractJsonObject(rawText)
  if (!jsonStr) {
    console.error('[bid-no-bid-analysis] no balanced JSON object found', rawText.slice(0, 1000))
    return respond({ error: 'AI did not return structured data — try again' }, 500)
  }

  let analysis: Record<string, unknown>
  try {
    analysis = JSON.parse(jsonStr)
  } catch (err) {
    console.error('[bid-no-bid-analysis] failed to parse JSON', err instanceof Error ? err.message : err, jsonStr.slice(0, 1000))
    return respond({ error: 'Could not parse AI response as JSON' }, 500)
  }

  const computedAt = new Date().toISOString()
  const { error: updErr } = await adminClient.from('opportunities').update({
    bid_no_bid_analysis: analysis,
    bid_no_bid_computed_at: computedAt,
  }).eq('id', body.opportunity_id)
  if (updErr) return respond({ error: updErr.message }, 500)

  return respond({ success: true, analysis, computed_at: computedAt })
})

function buildPrompt(
  opportunity: any,
  topMatches: any[],
  selectedTeam: any[],
  daysRemaining: number | null,
): string {
  const matchLines = topMatches.map((m: any) =>
    `- ${m.experts?.full_name ?? 'Unknown'} (${m.experts?.seniority_tier ?? 'n/a'}) — match ${m.match_score}/100`).join('\n') || 'Aucun matching calculé pour le moment.'

  const teamLines = selectedTeam.map((s: any) =>
    `- ${s.assigned_role_title}: ${s.experts?.full_name ?? 'TBD'} (${s.experts?.seniority_tier ?? 'n/a'}, ${s.experts?.years_experience ?? '?'} ans, statut: ${s.status})`).join('\n') || 'Aucune équipe assemblée pour le moment.'

  return `Tu es analyste senior en stratégie de soumission pour ACSD, un cabinet de conseil ouest-africain. Réalise une analyse Bid/No-Bid — une recommandation finale avant d'investir du temps dans la rédaction d'une proposition complète.

Contrairement au score stratégique déjà calculé sur les attributs de l'opportunité elle-même, cette analyse doit se baser sur la CAPACITÉ RÉELLE D'ACSD À GAGNER ET LIVRER CETTE MISSION MAINTENANT : profondeur du vivier d'experts disponibles, équipe effectivement assemblée à ce jour, et délai restant.

Opportunité : ${opportunity.title}
Organisation : ${opportunity.organization}
Type : ${opportunity.opportunity_type}
Jours restants avant échéance : ${daysRemaining != null ? daysRemaining : 'non renseigné'}
Score stratégique déjà calculé : ${opportunity.strategic_score != null ? opportunity.strategic_score + '/100' : 'non disponible'}
Justification du score stratégique : ${opportunity.strategic_score_rationale ?? 'non disponible'}
Critères d'évaluation du bailleur : ${JSON.stringify(opportunity.evaluation_criteria ?? [])}

Meilleurs experts identifiés par le moteur de matching (profondeur du vivier) :
${matchLines}

Équipe effectivement assemblée à ce jour :
${teamLines}

Retourne UNIQUEMENT un objet JSON valide (pas de markdown, pas d'explication) :

{
  "success_chance": "integer 0-100 — estimation factuelle basée sur les données ci-dessus, ne jamais surestimer sans preuve",
  "recommendation": "one of GO, CONDITIONAL_GO, NO_GO",
  "strengths": ["2-4 points forts factuels, en français, citant les données ci-dessus"],
  "risks": ["2-4 risques factuels, en français, citant les données ci-dessus — signaler explicitement si aucune équipe n'est encore assemblée ou si le délai est très court"],
  "rationale": "2-3 phrases en français résumant la recommandation globale"
}

Ne jamais inventer de faits au-delà de ce qui est fourni ci-dessus. Si les données sont insuffisantes pour juger un aspect (ex: aucune équipe assemblée), dis-le explicitement dans risks plutôt que d'extrapoler. Ceci est une recommandation d'aide à la décision interne, pas une décision finale automatique.

Return ONLY the JSON object.`
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const block = content.find((b: any) => b?.type === 'text')
  return block?.text ?? ''
}

// A naive greedy regex (first "{" to last "}") breaks the moment Claude adds
// any trailing commentary containing a brace. Scan from the first "{" and
// track brace depth (ignoring braces inside strings) to find the exact
// matching close brace instead.
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
