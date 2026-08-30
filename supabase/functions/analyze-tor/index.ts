import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { respond } from '../_shared/respond.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { callClaude, extractText, extractJsonObject } from '../_shared/claude.ts'
import { mimeFromExt, toBase64, extractDocxText } from '../_shared/fileParsing.ts'
import { CORS } from '../_shared/cors.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth

  // ── Parse input: a file upload, pasted text, or a URL to fetch ───────────
  // Three intake modes share the rest of the pipeline (vocab fetch, ACSD
  // profile, prompt, Claude call, cap logic) — this is the "analyse" command
  // (pasted text/link) from the Module 1 spec, and it also covers the
  // original TOR-upload flow. At most one of these three fields is expected.
  let formData: FormData
  try { formData = await req.formData() }
  catch { return respond({ error: 'Invalid multipart form data' }, 400) }

  const file      = formData.get('tor') as File | null
  const pastedText = (formData.get('text') as string | null)?.trim() || null
  const sourceUrl  = (formData.get('source_url') as string | null)?.trim() || null

  if (!file && !pastedText && !sourceUrl) {
    return respond({ error: 'Provide a file ("tor"), pasted text ("text"), or a URL ("source_url")' }, 400)
  }

  let isPDF = false
  let pdfBytes: Uint8Array | null = null
  let torText: string | null = null

  if (file) {
    if (file.size > 10 * 1024 * 1024) return respond({ error: 'File too large — maximum 10 MB' }, 400)
    if (file.size === 0) return respond({ error: 'File is empty' }, 400)

    const ext  = (file.name.split('.').pop() ?? '').toLowerCase()
    const mime = file.type || mimeFromExt(ext)
    isPDF        = mime === 'application/pdf' || ext === 'pdf'
    const isDOCX = mime.includes('wordprocessingml') || mime === 'application/msword' || ext === 'docx' || ext === 'doc'
    const isTXT  = mime === 'text/plain' || ext === 'txt'
    if (!isPDF && !isDOCX && !isTXT) return respond({ error: 'Unsupported format. Use PDF, DOCX, DOC, or TXT.' }, 400)

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (isPDF) {
      pdfBytes = bytes
    } else {
      torText = isDOCX ? extractDocxText(bytes) : new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    }
  } else if (pastedText) {
    torText = pastedText
  } else if (sourceUrl) {
    let urlObj: URL
    try { urlObj = new URL(sourceUrl) } catch { return respond({ error: 'Invalid URL' }, 400) }
    if (urlObj.protocol !== 'https:') return respond({ error: 'URL must be https' }, 400)
    if (isBlockedHost(urlObj.hostname)) return respond({ error: 'This URL is not allowed' }, 400)

    let fetchRes: Response
    try { fetchRes = await fetch(urlObj.toString(), { headers: { 'User-Agent': 'ACSD-Opportunity-Intelligence/1.0' } }) }
    catch (err) { return respond({ error: `Could not fetch URL: ${err instanceof Error ? err.message : 'network error'}` }, 502) }
    if (!fetchRes.ok) return respond({ error: `Source URL returned HTTP ${fetchRes.status}` }, 502)

    const raw = await fetchRes.text()
    torText = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  }

  if (torText !== null && !torText.trim()) {
    return respond({ error: 'Could not extract any usable text from the input' }, 400)
  }

  // ── Fetch controlled vocabulary for extraction ───────────────────────────
  const [sRes, lRes, gRes, aRes, dRes, wRes] = await Promise.all([
    adminClient.from('sectors').select('name').order('sort_order'),
    adminClient.from('languages').select('name').order('name'),
    adminClient.from('geographies').select('country_name').order('country_name'),
    adminClient.from('activity_types').select('name').order('name'),
    adminClient.from('donors').select('name').order('name'),
    adminClient.from('work_order_roles').select('name').order('name'),
  ])
  const sectors        = (sRes.data ?? []).map((r: { name: string }) => r.name)
  const languages       = (lRes.data ?? []).map((r: { name: string }) => r.name)
  const geographies     = (gRes.data ?? []).map((r: { country_name: string }) => r.country_name)
  const activityTypes   = (aRes.data ?? []).map((r: { name: string }) => r.name)
  const donors          = (dRes.data ?? []).map((r: { name: string }) => r.name)
  const workOrderRoles  = (wRes.data ?? []).map((r: { name: string }) => r.name)

  // ── Prepare Claude request ───────────────────────────────────────────────
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)

  const acsdProfile = await computeAcsdProfile(adminClient)
  const prompt = buildPrompt(sectors, languages, geographies, activityTypes, donors, workOrderRoles, acsdProfile)

  let messages: { role: string; content: unknown }[]

  if (isPDF && pdfBytes) {
    // No beta header needed for base64 PDF document blocks on current models
    // (the 2024-era pdfs-2024-09-25 flag this used to require has been GA'd).
    messages = [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(pdfBytes) } },
        { type: 'text', text: prompt },
      ],
    }]
  } else {
    messages = [{
      role: 'user',
      content: `${prompt}\n\n--- TOR TEXT ---\n${(torText ?? '').slice(0, 40000)}`,
    }]
  }

  // ── Call Claude ──────────────────────────────────────────────────────────
  // maxTokens is generous (16000, not the previous 4000) because Claude
  // Sonnet 5 runs adaptive thinking by default even when `thinking` is
  // omitted — unlike older Sonnet models, where no `thinking` param meant
  // no thinking at all. Those thinking tokens count against max_tokens, so
  // a low cap could be exhausted before any JSON text is emitted, which is
  // exactly what "AI did not return structured data" meant: the response
  // hit stop_reason "max_tokens" with an empty/truncated text block.
  // Pinning `effort: 'low'` keeps this extraction task (not open-ended
  // reasoning) from spending more of that budget on thinking than it needs.
  let claudeData: any
  try {
    claudeData = await callClaude({
      apiKey, model: 'claude-sonnet-5', maxTokens: 16000, messages,
      thinking: { type: 'adaptive' }, effort: 'low',
    })
  } catch (err) {
    return respond({ error: err instanceof Error ? err.message : 'Claude API call failed' }, 502)
  }

  const rawText: string = extractText(claudeData.content)

  const jsonStr = extractJsonObject(rawText)
  if (!jsonStr) {
    console.error('[analyze-tor] no balanced JSON object found — stop_reason:', claudeData.stop_reason, 'text:', rawText.slice(0, 1000))
    const truncated = claudeData.stop_reason === 'max_tokens'
    return respond({ error: truncated
      ? 'AI response was truncated before it finished — the document may be too long or complex. Try again, or split it into a shorter excerpt.'
      : 'AI did not return structured data — try a different file' }, 500)
  }

  let extracted: Record<string, unknown>
  try {
    extracted = JSON.parse(jsonStr)
  } catch (err) {
    console.error('[analyze-tor] failed to parse JSON', err instanceof Error ? err.message : err, jsonStr.slice(0, 1000))
    return respond({ error: 'Could not parse AI response as JSON' }, 500)
  }

  applyScoreCaps(extracted)

  return respond({ success: true, data: extracted })
})

// ── Scoring caps ─────────────────────────────────────────────────────────────
// The rubric's cap rules are business rules, not judgment calls — kept out of
// the model's hands the same way compute-matches keeps its scoring arithmetic
// out of the model's hands. Claude returns raw sub-scores + two flags; this
// function computes the total and applies the caps deterministically.
function applyScoreCaps(extracted: Record<string, unknown>): void {
  const breakdown = extracted.strategic_score_breakdown as Record<string, number> | undefined
  let total = breakdown
    ? Object.values(breakdown).reduce((sum: number, v) => sum + (Number(v) || 0), 0)
    : 0

  let confidence: 'confirmed' | 'to_confirm' = 'confirmed'

  if (extracted.has_blocking_eligibility_issue === true) {
    total = Math.min(total, 49)
  }
  if (extracted.source_fully_read === false) {
    total = Math.min(total, 84)
    confidence = 'to_confirm'
  }

  extracted.strategic_score = Math.round(Math.max(0, Math.min(100, total)))
  extracted.strategic_score_confidence = confidence
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// SSRF guard for the source_url intake path: blocks the obvious
// internal/loopback/link-local/cloud-metadata targets by hostname or
// IP-literal before this admin-gated endpoint fetches it server-side.
// This is a pattern check, not a DNS-rebinding-proof resolver — an
// attacker who fully controls DNS for a public hostname could still
// point it at a private IP after this check passes. Accepted residual
// risk given the caller must already hold a valid admin session token.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 127) return true                       // loopback
    if (a === 10) return true                         // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
    if (a === 192 && b === 168) return true            // 192.168.0.0/16
    if (a === 169 && b === 254) return true             // link-local + cloud metadata (169.254.169.254)
    if (a === 0) return true                            // 0.0.0.0/8
    return false
  }
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true // IPv6 loopback/link-local/unique-local

  return false
}

// Computed live from the actual roster (not a static snapshot) so scoring
// prompts stay current as the expert pool grows, without needing a settings
// UI to keep a positioning blurb in sync by hand.
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

  const topSectors      = topN(sectorRes.data ?? [], (r) => r.sectors?.name, 8)
  const topDonors       = topN(donorRes.data ?? [], (r) => r.donors?.name, 8)
  const topGeographies  = topN(geoRes.data ?? [], (r) => r.geographies?.country_name, 10)

  return `ACSD — a Burkina Faso-based consulting firm specializing in management, organizational transformation, governance, and institutional development, with a team of senior consultants and a local footprint across several West and Central African countries. Possible bidding status: bidding directly, lead firm of a consortium, or local partner — whichever structure best fits the opportunity.
Dominant sectors in the expert roster (by frequency): ${topSectors.join(', ') || 'not available'}.
Donors already served (by the roster's field experience): ${topDonors.join(', ') || 'not available'}.
Priority zones (by the roster's field experience): ${topGeographies.join(', ') || 'not available'} — UEMOA/ECOWAS as priority, Francophone and Anglophone Africa secondary.
Languages: French, English, national languages of West Africa.`
}

function buildPrompt(
  sectors: string[], languages: string[], geographies: string[],
  activityTypes: string[], donors: string[], workOrderRoles: string[],
  acsdProfile: string,
): string {
  return `You are a senior opportunity-intelligence and qualification analyst for ACSD, a West African consulting firm responding to donor RFPs/TORs (UN agencies, World Bank, AfDB, EU, USAID, etc.).

LANGUAGE OF YOUR OUTPUT — read this before anything else: detect the actual language the source TOR/RFP document itself is written in, then write "summary" and "strategic_score_rationale" in THAT language — an English document gets an English summary/rationale, a French document gets a French summary/rationale. This is the ONLY thing that should determine their language.

ACSD PROFILE (for evaluating fit — derived from the actual expert roster):
${acsdProfile}

Extract structured information from this Terms of Reference / RFP and return ONLY a valid JSON object (no markdown, no explanation):

{
  "title": "the opportunity/assignment title as written",
  "reference_number": "the formal RFP/TOR solicitation or reference number as printed in the document (e.g. 'RFP DDP-SEN-DKR-2026-05'), or null if the document doesn't state one",
  "organization": "the issuing organization/client exactly as written in the document",
  "donor_guess": "best-guess match from the Donors list below funding this opportunity, or null",
  "country": "best-guess match from the Geographies list below for the primary country of assignment, or null",
  "opportunity_type": "one of RFP, EOI, RFQ, REOI — infer from the document's own terminology",
  "deadline": "submission deadline as an ISO date (YYYY-MM-DD), or null if not stated",
  "summary": "a 2-4 sentence plain-language summary of what this assignment is about, written in the SAME LANGUAGE as the source document (English document -> English summary, French document -> French summary)",
  "evaluation_criteria": [ { "criterion": "short label for a scored evaluation criterion", "weight": "weight or points as stated, e.g. '30%' or '30 pts', or ''" } ],
  "sectors": [ { "name": "a name from the Sectors list below that matches a requirement", "importance": "required" or "preferred" } ],
  "languages": [ "names from the Languages list below that are required or preferred for this assignment" ],
  "geographies": [ "country names from the Geographies list below where relevant experience or coverage is required" ],
  "activity_types": [ "names from the Activity Types list below matching deliverables this TOR asks for" ],
  "positions": [ { "role_title": "the role/position name as written (e.g. 'Team Leader', 'Senior WASH Evaluator')", "required_seniority_tier": "one of junior, intermediary, senior, principal_expert — infer from years-of-experience requirements", "required_sector_guess": "best-guess match from the Sectors list, or null", "quantity": integer number of people needed for this role, default 1 } ],
  "strategic_score_breakdown": {
    "alignement_thematique": "integer 0-30 — the assignment's subject sits at the core of one of ACSD's flagship areas of expertise (30) vs a marginal/out-of-scope link (0), see ACSD PROFILE above",
    "adequation_geographique": "integer 0-15 — UEMOA/ECOWAS country where ACSD has a presence (15) vs outside West Africa (0)",
    "eligibilite_conformite": "integer 0-20 — no eliminatory criterion, all required documents available (20) vs an unmet requirement: turnover, years of existence, donor registration, similar references (0)",
    "valeur_strategique": "integer 0-20 — significant budget, strategic/structuring donor, durable leverage effect (20) vs a micro-contract with no follow-on potential (0)",
    "faisabilite_operationnelle": "integer 0-15 — comfortable deadline, light submission requirements, limited competition (15) vs deadline < 7 days or very heavy submission requirements (0)"
  },
  "has_blocking_eligibility_issue": "boolean — true if the document states an eligibility requirement ACSD cannot meet (e.g. minimum turnover, years of existence, prior donor registration, number of similar references) that is NOT satisfiable — this caps the total score regardless of thematic fit",
  "source_fully_read": "boolean — true only if you had complete access to the document's actual content; false if the document was truncated, partially unreadable, or you had to infer significant parts",
  "strategic_score_rationale": "2-3 factual sentences citing verifiable elements from the notice's text — no filler — written in the SAME LANGUAGE as the source document (English document -> English rationale, French document -> French rationale)"
}

Mandatory language rule: "summary" and "strategic_score_rationale" must be written in the source document's own language (TOR/RFP) — never automatically in French; an English document gets an English summary and rationale, a French document gets a French summary and rationale.

Mandatory scoring rules:
- Every score must be backed by a verifiable textual element from the document — never extrapolate.
- Missing data on a criterion = a low score on that specific criterion (in particular, penalize faisabilite_operationnelle if the deadline or workload isn't stated) — never guess in order to inflate a score.
- has_blocking_eligibility_issue and source_fully_read are factual indicators kept separate from the sub-score calculation — do not use them to manually adjust strategic_score_breakdown; the capping is applied automatically downstream.

Use semantic/fuzzy matching against the controlled vocabulary lists below — do not invent values outside these lists for sectors/languages/geographies/activity_types/donor_guess (positions' role_title is free text, taken verbatim from the document).

Sectors: ${sectors.join(', ')}

Languages: ${languages.join(', ')}

Geographies: ${geographies.join(', ')}

Activity Types: ${activityTypes.join(', ')}

Donors: ${donors.join(', ')}

Work order role types (context only, not a required output field): ${workOrderRoles.join(', ')}

Reminder: "summary" and "strategic_score_rationale" go in the source document's own language, not automatically in French — check what language the TOR/RFP text above is actually written in before writing them.

Return ONLY the JSON object.`
}
