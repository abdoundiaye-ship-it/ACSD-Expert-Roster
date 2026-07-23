import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

// Shared guardrail for every AI-drafted document: this function only ever
// produces editable drafts, and must never fabricate facts beyond what's
// explicitly passed in from the database.
const GUARDRAIL_SYSTEM = `You are drafting a competitive bid document for ACSD, an international development consultancy responding to a donor RFP/TOR. This output is an EDITABLE DRAFT for human review before submission — never state or imply it has already been submitted or finalized.

Only use the facts explicitly provided in the data given to you in this prompt. Do not invent, infer, or embellish names, employers, credentials, project references, countries, sectors, donors, or years of experience beyond what is given. If a claim would require information not present in the provided data, phrase that part generically instead of fabricating specifics.

Return clean semantic HTML (headings, paragraphs, lists, tables as appropriate) suitable for direct use inside a document — no markdown, no code fences, no <html>/<body> wrapper, just the inner content.`

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

  let body: { opportunity_id?: string; doc_type?: string; expert_id?: string }
  try { body = await req.json() }
  catch { return respond({ error: 'Invalid JSON body' }, 400) }

  const { opportunity_id: opportunityId, doc_type: docType, expert_id: expertId } = body
  if (!opportunityId) return respond({ error: 'opportunity_id is required' }, 400)
  if (!docType || !['eoi', 'technical_approach', 'workplan', 'expert_cv'].includes(docType)) {
    return respond({ error: 'doc_type must be one of eoi, technical_approach, workplan, expert_cv' }, 400)
  }
  if (docType === 'expert_cv' && !expertId) return respond({ error: 'expert_id is required for doc_type=expert_cv' }, 400)

  const { data: opportunity, error: oppErr } = await adminClient
    .from('opportunities')
    .select(`
      id, title, organization, summary, opportunity_type, evaluation_criteria, donor_id,
      opportunity_sectors(sector_id),
      opportunity_activity_types(activity_types(name)),
      opportunity_selected_experts(
        assigned_role_title, days_allocated,
        experts(id, full_name, title, seniority_tier)
      )
    `)
    .eq('id', opportunityId)
    .single()
  if (oppErr || !opportunity) return respond({ error: 'Opportunity not found' }, 404)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)

  try {
    if (docType === 'eoi') {
      const { title, content_html } = await generateEoi(apiKey, adminClient, opportunity)
      return respond({ success: true, doc_type: docType, title, content_html })
    }
    if (docType === 'technical_approach') {
      const { title, content_html } = await generateTechnicalApproach(apiKey, adminClient, opportunity)
      return respond({ success: true, doc_type: docType, title, content_html })
    }
    if (docType === 'workplan') {
      const { title, content_html } = await generateWorkplan(apiKey, opportunity)
      return respond({ success: true, doc_type: docType, title, content_html })
    }
    // expert_cv
    const { data: expert, error: expErr } = await adminClient
      .from('experts')
      .select(`
        id, full_name, title, affiliation_type, partner_org, seniority_tier, years_experience, bio_summary,
        expert_sectors(priority, sectors(name)),
        expert_geographies(geographies(country_name)),
        expert_donor_experience(notes, donors(name)),
        education_certifications(type, title, institution, year)
      `)
      .eq('id', expertId)
      .single()
    if (expErr || !expert) return respond({ error: 'Expert not found' }, 404)

    const { title, content_html } = await generateExpertCv(apiKey, opportunity, expert)
    return respond({ success: true, doc_type: docType, expert_id: expertId, title, content_html })

  } catch (err) {
    return respond({ error: err instanceof Error ? err.message : 'Generation failed' }, 502)
  }
})

// ── Document generators ────────────────────────────────────────────────────

async function generateEoi(apiKey: string, adminClient: any, opportunity: any) {
  const team = (opportunity.opportunity_selected_experts ?? []).map((s: any) => ({
    role: s.assigned_role_title, name: s.experts?.full_name, seniority: s.experts?.seniority_tier,
  }))
  const activities = (opportunity.opportunity_activity_types ?? []).map((a: any) => a.activity_types?.name).filter(Boolean)
  const sectorIds = (opportunity.opportunity_sectors ?? []).map((s: any) => s.sector_id)
  const kbContext = await fetchKbContext(adminClient, ['references', 'templates'], sectorIds, opportunity.donor_id)

  const prompt = `Draft an Expression of Interest (EOI) letter from ACSD for the following opportunity. Reference the proposed team by role and name only (no invented bios). 350-500 words, professional tone, structured in short paragraphs.

Opportunity title: ${opportunity.title}
Issuing organization: ${opportunity.organization}
Opportunity type: ${opportunity.opportunity_type}
Summary: ${opportunity.summary ?? 'Not provided.'}
Evaluation criteria: ${JSON.stringify(opportunity.evaluation_criteria ?? [])}
Deliverable/activity types covered: ${activities.join(', ') || 'Not specified.'}
Proposed team (role — name — seniority):
${team.map((t: any) => `- ${t.role} — ${t.name ?? 'TBD'} — ${t.seniority ?? 'n/a'}`).join('\n') || 'No team selected yet — write generically about ACSD\'s intent to mobilize a qualified team.'}
${kbContext}`

  const content_html = await callClaude(apiKey, prompt)
  return { title: `Expression of Interest — ${opportunity.title}`, content_html }
}

async function generateTechnicalApproach(apiKey: string, adminClient: any, opportunity: any) {
  const activities = (opportunity.opportunity_activity_types ?? []).map((a: any) => a.activity_types?.name).filter(Boolean)
  const sectorIds = (opportunity.opportunity_sectors ?? []).map((s: any) => s.sector_id)
  const kbContext = await fetchKbContext(adminClient, ['methodologies', 'donor_requirements'], sectorIds, opportunity.donor_id)

  const prompt = `Draft a Technical Approach / methodology section for ACSD's proposal to this opportunity. Propose a phased approach (typically 4-6 phases) appropriate to the opportunity's scope, inspired by ACSD's general style of institutional/organizational engagements (diagnostic, assessment, analysis/mapping, transformation or action planning, capacity strengthening) but adapted to what this specific opportunity actually asks for — do not force phases that don't fit. For each phase give a short name and 1-2 sentence description of activities and expected outputs. Do not invent specific past project references, client names, or statistics.

Opportunity title: ${opportunity.title}
Issuing organization: ${opportunity.organization}
Summary: ${opportunity.summary ?? 'Not provided.'}
Evaluation criteria: ${JSON.stringify(opportunity.evaluation_criteria ?? [])}
Deliverable/activity types covered: ${activities.join(', ') || 'Not specified.'}
${kbContext}`

  const content_html = await callClaude(apiKey, prompt)
  return { title: `Technical Approach — ${opportunity.title}`, content_html }
}

// ── Knowledge base retrieval (Module 7) ─────────────────────────────────────
// Not true semantic/vector search — this is an MVP-scale retrieval: filter by
// category, prioritize documents tagged with a matching sector or the same
// donor, fall back to most-recent. Cheap, auditable, no new infrastructure.
async function fetchKbContext(
  adminClient: any, categories: string[], sectorIds: number[], donorId: number | null,
): Promise<string> {
  const { data } = await adminClient
    .from('knowledge_base_documents')
    .select('title, category, extracted_text, sector_id, donor_id')
    .in('category', categories)
    .not('extracted_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20)

  const docs = data ?? []
  if (docs.length === 0) return ''

  const ranked = docs
    .map((d: any) => ({
      doc: d,
      score: (d.sector_id && sectorIds.includes(d.sector_id) ? 2 : 0) + (d.donor_id && donorId && d.donor_id === donorId ? 2 : 0),
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 2)
    .map((r: any) => r.doc)

  if (ranked.length === 0) return ''

  const excerpts = ranked.map((d: any) => `[${d.category}] ${d.title}:\n${String(d.extracted_text).slice(0, 2000)}`).join('\n\n---\n\n')
  return `\nReference material from ACSD's own proposal knowledge base, reflecting its established style and past project experience (use for tone/structure/phrasing inspiration only — do not copy specific factual claims like client names, figures, or references from this unless they also appear in the opportunity data above):\n${excerpts}\n`
}

async function generateWorkplan(apiKey: string, opportunity: any) {
  const team = (opportunity.opportunity_selected_experts ?? []).map((s: any) => ({
    role: s.assigned_role_title, name: s.experts?.full_name ?? 'TBD', days: s.days_allocated ?? null,
  }))
  const activities = (opportunity.opportunity_activity_types ?? []).map((a: any) => a.activity_types?.name).filter(Boolean)

  // The table itself is built deterministically from stored data — no
  // fabrication risk. Claude only supplies short connective narrative text
  // that introduces the table; it does not invent rows, days, or names.
  const tableRows = team.map((t: any) =>
    `<tr><td>${escapeHtml(t.role)}</td><td>${escapeHtml(t.name)}</td><td>${t.days != null ? t.days : '—'}</td></tr>`
  ).join('')
  const tableHtml = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
    <thead><tr><th>Role / Position</th><th>Assigned Expert</th><th>Days Allocated</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="3">No team assigned yet.</td></tr>'}</tbody>
  </table>`

  const prompt = `Write a short (100-180 word) introductory narrative for a Workplan section, explaining the sequencing logic of the assignment below. Do not list specific dates, days, or names — those are already provided in a table that will be placed after your text; just describe the general flow/sequencing at a high level.

Opportunity title: ${opportunity.title}
Summary: ${opportunity.summary ?? 'Not provided.'}
Deliverable/activity types covered: ${activities.join(', ') || 'Not specified.'}
Roles on the team: ${team.map((t: any) => t.role).join(', ') || 'Not yet assigned.'}`

  const narrative = await callClaude(apiKey, prompt)
  return { title: `Workplan — ${opportunity.title}`, content_html: `${narrative}\n${tableHtml}` }
}

async function generateExpertCv(apiKey: string, opportunity: any, expert: any) {
  const sectors = (expert.expert_sectors ?? []).map((s: any) => `${s.sectors?.name} (${s.priority})`).join(', ')
  const geographies = (expert.expert_geographies ?? []).map((g: any) => g.geographies?.country_name).join(', ')
  const donorExperience = (expert.expert_donor_experience ?? [])
    .map((d: any) => `${d.donors?.name}${d.notes ? ` — ${d.notes}` : ''}`).join('; ')
  const education = (expert.education_certifications ?? [])
    .map((e: any) => `${e.title}${e.institution ? `, ${e.institution}` : ''}${e.year ? ` (${e.year})` : ''} [${e.type}]`).join('; ')

  const prompt = `Rewrite this expert's professional summary to emphasize the parts of their SOURCE DATA most relevant to the opportunity below. This is a REWRITE task: reorganize and emphasize, do not add any employer, project, credential, sector, country, or achievement that is not present in SOURCE DATA. Output an HTML CV-style block with: a header (name, title), a 3-5 sentence tailored summary paragraph, a "Key Sectors" list, a "Donor Experience" list, and an "Education & Certifications" list — all drawn only from SOURCE DATA.

Opportunity title: ${opportunity.title}
Opportunity summary: ${opportunity.summary ?? 'Not provided.'}

SOURCE DATA for ${expert.full_name}:
Title: ${expert.title ?? 'n/a'}
Affiliation: ${expert.affiliation_type}${expert.partner_org ? ` (${expert.partner_org})` : ''}
Seniority: ${expert.seniority_tier ?? 'n/a'}
Years of experience: ${expert.years_experience ?? 'n/a'}
Existing bio summary: ${expert.bio_summary ?? 'n/a'}
Sectors: ${sectors || 'n/a'}
Geographic experience: ${geographies || 'n/a'}
Donor experience: ${donorExperience || 'n/a'}
Education & certifications: ${education || 'n/a'}`

  const content_html = await callClaude(apiKey, prompt)
  return { title: `Tailored CV — ${expert.full_name}`, content_html }
}

// ── Claude call ──────────────────────────────────────────────────────────────

async function callClaude(apiKey: string, userPrompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2500,
      system: GUARDRAIL_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API error (${res.status}): ${errText.slice(0, 400)}`)
  }
  const data = await res.json()
  const text: string = extractText(data.content)
  if (!text.trim()) throw new Error('AI returned an empty response')
  return text.trim()
}

// Claude's content array isn't always [textBlock] — a leading non-text
// block (e.g. extended thinking) would silently produce an empty string
// if we blindly read content[0].text. Find the actual text block instead.
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const block = content.find((b: any) => b?.type === 'text')
  return block?.text ?? ''
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
