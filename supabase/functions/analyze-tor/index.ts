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
    if (!['http:', 'https:'].includes(urlObj.protocol)) return respond({ error: 'URL must be http(s)' }, 400)

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

  let messages: unknown[]
  const extraHeaders: Record<string, string> = {}

  if (isPDF && pdfBytes) {
    extraHeaders['anthropic-beta'] = 'pdfs-2024-09-25'
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
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       apiKey,
      'anthropic-version': '2023-06-01',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model:      'claude-sonnet-5',
      max_tokens: 4000,
      messages,
    }),
  })

  if (!claudeRes.ok) {
    const errText = await claudeRes.text()
    return respond({ error: `Claude API error (${claudeRes.status}): ${errText.slice(0, 400)}` }, 502)
  }

  const claudeData = await claudeRes.json()
  const rawText: string = extractText(claudeData.content)

  const jsonStr = extractJsonObject(rawText)
  if (!jsonStr) {
    console.error('[analyze-tor] no balanced JSON object found', rawText.slice(0, 1000))
    return respond({ error: 'AI did not return structured data — try a different file' }, 500)
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

// Claude's content array isn't always [textBlock] — a leading non-text
// block (e.g. extended thinking) would silently produce an empty string
// if we blindly read content[0].text. Find the actual text block instead.
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const block = content.find((b: any) => b?.type === 'text')
  return block?.text ?? ''
}

// A naive greedy regex (first "{" to last "}") breaks the moment Claude adds
// any trailing commentary containing a brace, and a non-greedy one breaks on
// nested objects (this schema now has a nested strategic_score_breakdown).
// Scan from the first "{" and track brace depth (ignoring braces inside
// strings) to find the exact matching close brace instead.
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

function mimeFromExt(ext: string): string {
  return ({ pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            doc:'application/msword', txt:'text/plain' } as Record<string,string>)[ext] ?? 'application/octet-stream'
}

function toBase64(bytes: Uint8Array): string {
  const CHUNK = 8192
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return btoa(bin)
}

function extractDocxText(bytes: Uint8Array): string {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const matches = [...raw.matchAll(/<w:t(?:\s[^>]*)?>([^<]+)<\/w:t>/g)]
  if (matches.length > 0) {
    return matches.map(m => m[1]).join(' ').replace(/\s+/g, ' ').trim()
  }
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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

  return `ACSD — cabinet de conseil basé au Burkina Faso, spécialisé en management, transformation organisationnelle, gouvernance et développement institutionnel, avec une équipe de consultants seniors et un ancrage local dans plusieurs pays d'Afrique de l'Ouest et Centrale. Statut de soumission possible : cabinet en soumission propre, chef de file de groupement, ou partenaire local — selon le montage le plus pertinent pour l'opportunité.
Secteurs dominants du vivier d'experts (par fréquence) : ${topSectors.join(', ') || 'non disponible'}.
Bailleurs déjà servis (par expérience terrain du vivier) : ${topDonors.join(', ') || 'non disponible'}.
Zones prioritaires (par expérience terrain du vivier) : ${topGeographies.join(', ') || 'non disponible'} — UEMOA/CEDEAO en priorité, Afrique francophone et anglophone en secondaire.
Langues : français, anglais, langues nationales d'Afrique de l'Ouest.`
}

function buildPrompt(
  sectors: string[], languages: string[], geographies: string[],
  activityTypes: string[], donors: string[], workOrderRoles: string[],
  acsdProfile: string,
): string {
  return `Tu es analyste senior en veille et qualification d'appels d'offres pour ACSD, un cabinet de conseil ouest-africain répondant à des RFP/TOR de bailleurs (agences onusiennes, Banque mondiale, BAD, UE, USAID, etc.).

PROFIL ACSD (pour évaluer l'alignement — dérivé du vivier d'experts réel) :
${acsdProfile}

Extrait les informations structurées de ce Terms of Reference / RFP et retourne UNIQUEMENT un objet JSON valide (pas de markdown, pas d'explication) :

{
  "title": "the opportunity/assignment title as written",
  "reference_number": "the formal RFP/TOR solicitation or reference number as printed in the document (e.g. 'RFP DDP-SEN-DKR-2026-05'), or null if the document doesn't state one",
  "organization": "the issuing organization/client exactly as written in the document",
  "donor_guess": "best-guess match from the Donors list below funding this opportunity, or null",
  "country": "best-guess match from the Geographies list below for the primary country of assignment, or null",
  "opportunity_type": "one of RFP, EOI, RFQ, REOI — infer from the document's own terminology",
  "deadline": "submission deadline as an ISO date (YYYY-MM-DD), or null if not stated",
  "summary": "a 2-4 sentence plain-language summary of what this assignment is about",
  "evaluation_criteria": [ { "criterion": "short label for a scored evaluation criterion", "weight": "weight or points as stated, e.g. '30%' or '30 pts', or ''" } ],
  "sectors": [ { "name": "a name from the Sectors list below that matches a requirement", "importance": "required" or "preferred" } ],
  "languages": [ "names from the Languages list below that are required or preferred for this assignment" ],
  "geographies": [ "country names from the Geographies list below where relevant experience or coverage is required" ],
  "activity_types": [ "names from the Activity Types list below matching deliverables this TOR asks for" ],
  "positions": [ { "role_title": "the role/position name as written (e.g. 'Team Leader', 'Senior WASH Evaluator')", "required_seniority_tier": "one of junior, intermediary, senior, principal_expert — infer from years-of-experience requirements", "required_sector_guess": "best-guess match from the Sectors list, or null", "quantity": integer number of people needed for this role, default 1 } ],
  "strategic_score_breakdown": {
    "alignement_thematique": "integer 0-30 — objet du marché au cœur d'une expertise phare d'ACSD (30) vs lien marginal/hors périmètre (0), voir PROFIL ACSD ci-dessus",
    "adequation_geographique": "integer 0-15 — pays UEMOA/CEDEAO où ACSD est implanté (15) vs hors Afrique de l'Ouest (0)",
    "eligibilite_conformite": "integer 0-20 — aucun critère éliminatoire, toutes pièces disponibles (20) vs exigence non satisfaite : CA, années d'existence, enregistrement bailleur, références similaires (0)",
    "valeur_strategique": "integer 0-20 — budget significatif, bailleur structurant, effet de levier durable (20) vs micro-marché sans suite (0)",
    "faisabilite_operationnelle": "integer 0-15 — délai confortable, dossier léger, concurrence limitée (15) vs délai < 7 jours ou dossier très lourd (0)"
  },
  "has_blocking_eligibility_issue": "boolean — true if the document states an eligibility requirement ACSD cannot meet (e.g. minimum turnover, years of existence, prior donor registration, number of similar references) that is NOT satisfiable — this caps the total score regardless of thematic fit",
  "source_fully_read": "boolean — true only if you had complete access to the document's actual content; false if the document was truncated, partially unreadable, or you had to infer significant parts",
  "strategic_score_rationale": "2-3 phrases factuelles, en français, citant des éléments vérifiables du texte de l'avis — pas de remplissage"
}

Règles de notation impératives :
- Chaque note doit s'appuyer sur un élément textuel vérifiable du document — ne jamais extrapoler.
- Donnée manquante sur un critère = note basse sur ce critère spécifique (notamment un malus sur faisabilite_operationnelle si le délai ou la charge de travail ne sont pas précisés) — ne jamais deviner pour gonfler un score.
- has_blocking_eligibility_issue et source_fully_read sont des indicateurs factuels séparés du calcul des sous-scores — ne les utilise pas pour ajuster manuellement strategic_score_breakdown, le plafonnement est appliqué automatiquement en aval.

Use semantic/fuzzy matching against the controlled vocabulary lists below — do not invent values outside these lists for sectors/languages/geographies/activity_types/donor_guess (positions' role_title is free text, taken verbatim from the document).

Sectors: ${sectors.join(', ')}

Languages: ${languages.join(', ')}

Geographies: ${geographies.join(', ')}

Activity Types: ${activityTypes.join(', ')}

Donors: ${donors.join(', ')}

Work order role types (context only, not a required output field): ${workOrderRoles.join(', ')}

Return ONLY the JSON object.`
}
