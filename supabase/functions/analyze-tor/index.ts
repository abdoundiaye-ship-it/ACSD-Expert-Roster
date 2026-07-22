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

  // ── Parse uploaded file ──────────────────────────────────────────────────
  let formData: FormData
  try { formData = await req.formData() }
  catch { return respond({ error: 'Invalid multipart form data' }, 400) }

  const file = formData.get('tor') as File | null
  if (!file) return respond({ error: 'No file provided (field name must be "tor")' }, 400)
  if (file.size > 10 * 1024 * 1024) return respond({ error: 'File too large — maximum 10 MB' }, 400)
  if (file.size === 0) return respond({ error: 'File is empty' }, 400)

  const ext  = (file.name.split('.').pop() ?? '').toLowerCase()
  const mime = file.type || mimeFromExt(ext)
  const isPDF  = mime === 'application/pdf'  || ext === 'pdf'
  const isDOCX = mime.includes('wordprocessingml') || mime === 'application/msword' ||
                 ext === 'docx' || ext === 'doc'
  const isTXT  = mime === 'text/plain' || ext === 'txt'

  if (!isPDF && !isDOCX && !isTXT) {
    return respond({ error: 'Unsupported format. Use PDF, DOCX, DOC, or TXT.' }, 400)
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

  const bytes  = new Uint8Array(await file.arrayBuffer())
  const prompt = buildPrompt(sectors, languages, geographies, activityTypes, donors, workOrderRoles)

  let messages: unknown[]
  const extraHeaders: Record<string, string> = {}

  if (isPDF) {
    extraHeaders['anthropic-beta'] = 'pdfs-2024-09-25'
    messages = [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) } },
        { type: 'text', text: prompt },
      ],
    }]
  } else {
    const torText = isDOCX
      ? extractDocxText(bytes)
      : new TextDecoder('utf-8', { fatal: false }).decode(bytes)

    if (!torText.trim()) return respond({ error: 'Could not extract any text from the file' }, 400)

    messages = [{
      role: 'user',
      content: `${prompt}\n\n--- TOR TEXT ---\n${torText.slice(0, 40000)}`,
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

  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return respond({ error: 'AI did not return structured data — try a different file' }, 500)

  let extracted: Record<string, unknown>
  try { extracted = JSON.parse(jsonMatch[0]) }
  catch { return respond({ error: 'Could not parse AI response as JSON' }, 500) }

  return respond({ success: true, data: extracted })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function buildPrompt(
  sectors: string[], languages: string[], geographies: string[],
  activityTypes: string[], donors: string[], workOrderRoles: string[],
): string {
  return `You are a professional bid analyst for an international development consulting firm (ACSD) that responds to donor RFPs/TORs (UN agencies, World Bank, AfDB, EU, USAID, etc.).

Extract structured information from this Terms of Reference / RFP document and return ONLY a valid JSON object (no markdown, no explanation):

{
  "title": "the opportunity/assignment title as written",
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
  "strategic_score": integer 0-100 rating how strategically valuable and winnable this opportunity looks for a West/Central Africa-focused management, governance, and institutional development consultancy,
  "strategic_score_rationale": "1-2 sentence justification for the strategic_score, referencing alignment with ACSD's sector strengths and regional presence"
}

Use semantic/fuzzy matching against the controlled vocabulary lists below — do not invent values outside these lists for sectors/languages/geographies/activity_types/donor_guess (positions' role_title is free text, taken verbatim from the document).

Sectors: ${sectors.join(', ')}

Languages: ${languages.join(', ')}

Geographies: ${geographies.join(', ')}

Activity Types: ${activityTypes.join(', ')}

Donors: ${donors.join(', ')}

Work order role types (context only, not a required output field): ${workOrderRoles.join(', ')}

Return ONLY the JSON object.`
}
