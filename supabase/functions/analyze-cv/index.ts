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

  const file = formData.get('cv') as File | null
  if (!file) return respond({ error: 'No file provided (field name must be "cv")' }, 400)
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

  // ── Fetch controlled vocabulary for matching ─────────────────────────────
  const [sRes, lRes, gRes] = await Promise.all([
    adminClient.from('sectors').select('name').order('sort_order'),
    adminClient.from('languages').select('name').order('name'),
    adminClient.from('geographies').select('country_name').order('country_name'),
  ])
  const sectors     = (sRes.data ?? []).map((r: { name: string })         => r.name)
  const languages   = (lRes.data ?? []).map((r: { name: string })         => r.name)
  const geographies = (gRes.data ?? []).map((r: { country_name: string }) => r.country_name)

  // ── Prepare Claude request ───────────────────────────────────────────────
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)

  const bytes  = new Uint8Array(await file.arrayBuffer())
  const prompt = buildPrompt(sectors, languages, geographies)

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
    const cvText = isDOCX
      ? extractDocxText(bytes)
      : new TextDecoder('utf-8', { fatal: false }).decode(bytes)

    if (!cvText.trim()) return respond({ error: 'Could not extract any text from the file' }, 400)

    messages = [{
      role: 'user',
      content: `${prompt}\n\n--- CV TEXT ---\n${cvText.slice(0, 18000)}`,
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
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages,
    }),
  })

  if (!claudeRes.ok) {
    const errText = await claudeRes.text()
    return respond({ error: `Claude API error (${claudeRes.status}): ${errText.slice(0, 400)}` }, 502)
  }

  const claudeData = await claudeRes.json()
  const rawText: string = claudeData.content?.[0]?.text ?? ''

  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return respond({ error: 'AI did not return structured data — try a different file' }, 500)

  let extracted: Record<string, unknown>
  try { extracted = JSON.parse(jsonMatch[0]) }
  catch { return respond({ error: 'Could not parse AI response as JSON' }, 500) }

  return respond({ success: true, data: extracted })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function buildPrompt(sectors: string[], languages: string[], geographies: string[]): string {
  return `You are a professional CV parser for an international development consulting roster.

Extract structured information from this CV and return ONLY a valid JSON object (no markdown, no explanation):

{
  "full_name": "complete name as written, including Dr./Prof. prefix if present",
  "first_name": "given name only",
  "last_name": "family name only",
  "title": "current or most recent job title",
  "email": "email address or null",
  "phone": "phone number or null",
  "organization": "current employer or main organization, or null",
  "affiliation_type": "internal" or "partner" — default to "partner" unless clearly a core/internal staff,
  "years_experience": total years of professional experience as an integer,
  "seniority_tier": "junior" for under 3 yrs, "intermediary" for 3–7 yrs, "senior" for 7–15 yrs, "principal_expert" for 15+ yrs,
  "bio_summary": "2–3 sentence professional summary written in third person, highlighting expertise and impact",
  "sectors": [only names from the Sectors list below that match this person's expertise],
  "languages": [only names from the Languages list below that this person speaks or works in],
  "geographies": [only country names from the Geographies list below where this person has worked],
  "confidence_notes": "brief note if any field has low confidence, or 'High confidence' if all clear"
}

Use semantic/fuzzy matching for sectors (e.g. "public health" → "Health", "climate change" → "Environment & Natural Resources", "financial management" → "Public Financial Management").

Sectors: ${sectors.join(', ')}

Languages: ${languages.join(', ')}

Geographies: ${geographies.join(', ')}

Return ONLY the JSON object.`
}
