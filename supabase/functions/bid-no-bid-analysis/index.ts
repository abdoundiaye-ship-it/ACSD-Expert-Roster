import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { respond } from '../_shared/respond.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { CORS } from '../_shared/cors.ts'

// Deterministic Bid/No-Bid — no LLM, no external API, no cost. The
// recommendation is computed from four real signals the system already holds:
//   1. the opportunity's strategic score (fit of the opportunity itself),
//   2. depth + quality of the matched expert pool (opportunity_expert_matches),
//   3. the team actually assembled so far (opportunity_selected_experts),
//   4. the time remaining before the deadline.
// Every number in the output is traceable to these inputs (see `components`),
// which is why this replaces the previous Claude call: a transparent, auditable,
// zero-cost rule beats an opaque paid generation for a go/no-go gate.

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth

  let body: { opportunity_id?: string }
  try { body = await req.json() }
  catch { return respond({ error: 'Invalid JSON body' }, 400) }
  if (!body.opportunity_id) return respond({ error: 'opportunity_id is required' }, 400)

  const { data: opportunity, error: oppErr } = await adminClient
    .from('opportunities')
    .select('id, title, organization, opportunity_type, deadline, strategic_score, strategic_score_rationale')
    .eq('id', body.opportunity_id)
    .single()
  if (oppErr || !opportunity) return respond({ error: 'Opportunity not found' }, 404)

  // Depth/quality of the matched pool (regardless of position).
  const { data: topMatches } = await adminClient
    .from('opportunity_expert_matches')
    .select('match_score, experts(full_name, seniority_tier)')
    .eq('opportunity_id', body.opportunity_id)
    .order('match_score', { ascending: false })
    .limit(10)

  // Team actually committed so far.
  const { data: selectedTeam } = await adminClient
    .from('opportunity_selected_experts')
    .select('status')
    .eq('opportunity_id', body.opportunity_id)

  const daysRemaining = opportunity.deadline
    ? Math.ceil((new Date(opportunity.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  const analysis = computeBidNoBid(opportunity, topMatches ?? [], selectedTeam ?? [], daysRemaining)

  const computedAt = new Date().toISOString()
  const { error: updErr } = await adminClient.from('opportunities').update({
    bid_no_bid_analysis: analysis,
    bid_no_bid_computed_at: computedAt,
  }).eq('id', body.opportunity_id)
  if (updErr) return respond({ error: updErr.message }, 500)

  return respond({ success: true, analysis, computed_at: computedAt })
})

const round = (n: number) => Math.round(n * 10) / 10

function computeBidNoBid(opportunity: any, topMatches: any[], selectedTeam: any[], daysRemaining: number | null) {
  const strategicScore: number | null = typeof opportunity.strategic_score === 'number' ? opportunity.strategic_score : null

  const scores = topMatches.map(m => Number(m?.match_score) || 0).sort((a, b) => b - a)
  const poolSize = scores.length
  const topScore = scores[0] ?? 0
  const topExpert = topMatches[0]?.experts?.full_name ?? null
  const avgTop3 = poolSize ? scores.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, poolSize) : 0
  const STRONG = 60
  const strongCount = scores.filter(s => s >= STRONG).length

  const teamSize = selectedTeam.length
  const committed = selectedTeam.filter(s => s.status === 'selected' || s.status === 'confirmed').length

  // ── Component scores (weights: strategic 35, pool 35, team 15, timeline 15) ──
  const strategicFit = strategicScore != null ? (strategicScore / 100) * 35 : 17.5 // neutral if unscored

  const poolQuality = Math.min(1, avgTop3 / 80) * 20       // avg of top-3 reaching 80/100 → full 20
  const poolDepth   = (Math.min(strongCount, 5) / 5) * 15  // 5+ strong (≥60) matches → full 15
  const poolScore   = poolQuality + poolDepth

  const teamReadiness = committed >= 1
    ? (Math.min(committed, 3) / 3) * 15                    // up to 3 confirmed/selected → full 15
    : (teamSize >= 1 ? 3 : 0)                              // shortlisted-only → small credit

  let timeline: number
  if (daysRemaining == null) timeline = 9                  // unknown → mildly cautious
  else if (daysRemaining < 0) timeline = 0                 // deadline passed
  else if (daysRemaining < 7) timeline = 2
  else if (daysRemaining < 14) timeline = 7
  else if (daysRemaining < 30) timeline = 12
  else timeline = 15

  let success = Math.round(strategicFit + poolScore + teamReadiness + timeline)
  success = Math.max(0, Math.min(100, success))

  // ── Recommendation + hard gates ──
  let recommendation: 'GO' | 'CONDITIONAL_GO' | 'NO_GO'
  if (success >= 65) recommendation = 'GO'
  else if (success >= 45) recommendation = 'CONDITIONAL_GO'
  else recommendation = 'NO_GO'
  // Deadline already passed is an absolute blocker.
  if (daysRemaining != null && daysRemaining < 0) recommendation = 'NO_GO'
  // Can't responsibly say GO when the pool hasn't even been computed.
  if (poolSize === 0 && recommendation === 'GO') recommendation = 'CONDITIONAL_GO'

  // ── Explainable strengths (cite the actual numbers) ──
  const strengths: string[] = []
  if (strategicScore != null && strategicScore >= 65) strengths.push(`Score stratégique élevé (${strategicScore}/100) sur les attributs de l'opportunité.`)
  if (topScore > 0) strengths.push(`Meilleur profil du vivier : ${topExpert ?? 'expert'} (matching ${round(topScore)}/100).`)
  if (strongCount >= 1) strengths.push(`${strongCount} expert(s) à fort alignement (score de matching ≥ ${STRONG}/100) disponibles.`)
  if (committed >= 1) strengths.push(`Équipe déjà engagée : ${committed} membre(s) confirmé(s)/sélectionné(s).`)
  if (daysRemaining != null && daysRemaining >= 30) strengths.push(`Délai confortable : ${daysRemaining} jours avant l'échéance.`)
  if (strengths.length === 0) strengths.push('Aucun signal fort positif à ce stade — voir les risques et renforcer les données avant de décider.')

  // ── Explainable risks ──
  const risks: string[] = []
  if (poolSize === 0) risks.push('Aucun matching calculé pour cette opportunité : lancez « Compute Matches » pour mesurer la profondeur du vivier.')
  else if (strongCount === 0) risks.push(`Vivier limité : aucun expert avec un matching ≥ ${STRONG}/100 (meilleur score : ${round(topScore)}/100).`)
  if (teamSize === 0) risks.push('Aucune équipe assemblée à ce jour.')
  else if (committed === 0) risks.push('Équipe encore au stade présélection : aucun membre confirmé ou sélectionné.')
  if (daysRemaining != null && daysRemaining < 0) risks.push(`Échéance dépassée depuis ${Math.abs(daysRemaining)} jour(s) — soumission impossible.`)
  else if (daysRemaining != null && daysRemaining < 7) risks.push(`Délai très court : ${daysRemaining} jour(s) avant l'échéance.`)
  else if (daysRemaining == null) risks.push('Échéance non renseignée — impossible d\'évaluer la contrainte de délai.')
  if (strategicScore == null) risks.push('Score stratégique non calculé pour cette opportunité.')
  else if (strategicScore < 50) risks.push(`Score stratégique faible (${strategicScore}/100).`)
  if (risks.length === 0) risks.push('Aucun risque bloquant identifié à partir des données disponibles.')

  const rationale = `Probabilité de succès estimée à ${success}% → ${recommendation}. ` +
    `Calcul déterministe à partir de quatre signaux : score stratégique (${strategicScore != null ? strategicScore + '/100' : 'n/d'}), ` +
    `profondeur du vivier (${poolSize} profils matchés, ${strongCount} à ≥${STRONG}/100), ` +
    `équipe engagée (${committed}/${teamSize}), et délai (${daysRemaining != null ? daysRemaining + ' j' : 'n/d'}). ` +
    `Aide à la décision interne, sans appel à un service d'IA externe.`

  return {
    success_chance: success,
    recommendation,
    strengths,
    risks,
    rationale,
    method: 'deterministic',
    components: {
      strategic_fit: round(strategicFit),
      pool: round(poolScore),
      team_readiness: round(teamReadiness),
      timeline: round(timeline),
    },
    signals: {
      strategic_score: strategicScore,
      pool_size: poolSize,
      top_match_score: round(topScore),
      strong_matches: strongCount,
      team_size: teamSize,
      team_committed: committed,
      days_remaining: daysRemaining,
    },
  }
}
