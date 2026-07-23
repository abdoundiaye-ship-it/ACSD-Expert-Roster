import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

const MAX_DIGEST_CHARS = 6000
const CATEGORIES = ['methodologies', 'technical_proposals', 'cvs', 'references', 'donor_requirements', 'templates']

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

  let formData: FormData
  try { formData = await req.formData() }
  catch { return respond({ error: 'Invalid multipart form data' }, 400) }

  const file = formData.get('file') as File | null
  if (!file) return respond({ error: 'No file provided (field name must be "file")' }, 400)
  if (file.size > 10 * 1024 * 1024) return respond({ error: 'File too large — maximum 10 MB' }, 400)
  if (file.size === 0) return respond({ error: 'File is empty' }, 400)

  const ext  = (file.name.split('.').pop() ?? '').toLowerCase()
  const mime = file.type || mimeFromExt(ext)
  const isPDF  = mime === 'application/pdf' || ext === 'pdf'
  const isDOCX = mime.includes('wordprocessingml') || mime === 'application/msword' || ext === 'docx' || ext === 'doc'
  const isTXT  = mime === 'text/plain' || ext === 'txt'
  if (!isPDF && !isDOCX && !isTXT) return respond({ error: 'Unsupported format. Use PDF, DOCX, DOC, or TXT.' }, 400)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)

  const bytes = new Uint8Array(await file.arrayBuffer())

  try {
    if (isPDF) {
      // Long PDFs risk Claude paraphrasing rather than transcribing verbatim,
      // so this is explicitly a condensed digest, not a claimed transcript —
      // fine for the "style/precedent reference" use case, not for anything
      // needing exact quotes.
      const digest = await digestPdf(apiKey, bytes)
      return respond({ success: true, data: digest })
    }

    const rawText = isDOCX ? extractDocxText(bytes) : new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (!rawText.trim()) return respond({ error: 'Could not extract any text from the file' }, 400)

    return respond({
      success: true,
      data: {
        suggested_title: file.name.replace(/\.[^.]+$/, ''),
        suggested_category: null, // no reliable category signal without an AI pass; admin picks
        extracted_text: rawText.slice(0, MAX_DIGEST_CHARS),
      },
    })
  } catch (err) {
    return respond({ error: err instanceof Error ? err.message : 'Analysis failed' }, 502)
  }
})

async function digestPdf(apiKey: string, bytes: Uint8Array): Promise<{ suggested_title: string; suggested_category: string | null; extracted_text: string }> {
  const prompt = `This is a document being added to ACSD's internal proposal knowledge base, used as a style/precedent reference when drafting future donor proposals. Produce a CONDENSED, FAITHFUL DIGEST — not a verbatim transcript — return ONLY a JSON object:

{
  "suggested_title": "a short descriptive title for this document",
  "suggested_category": "your best guess, one of: ${CATEGORIES.join(', ')}",
  "extracted_text": "a condensed digest (max ~${MAX_DIGEST_CHARS} characters) capturing: the document's structure/phases if it's a methodology, notable phrasing/style patterns, and any project references or donor requirements explicitly stated — omit boilerplate and formatting artifacts"
}

Return ONLY the JSON object.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })
  if (!res.ok) throw new Error(`Claude API error (${res.status}): ${(await res.text()).slice(0, 400)}`)

  const data = await res.json()
  const rawText = extractText(data.content)
  const jsonStr = extractJsonObject(rawText)
  if (!jsonStr) {
    console.error('[analyze-kb-document] no balanced JSON object found', rawText.slice(0, 1000))
    throw new Error('AI did not return structured data — try a different file')
  }

  let parsed: any
  try {
    parsed = JSON.parse(jsonStr)
  } catch (err) {
    console.error('[analyze-kb-document] failed to parse JSON', err instanceof Error ? err.message : err, jsonStr.slice(0, 1000))
    throw new Error('Could not parse AI response as JSON')
  }

  return {
    suggested_title: parsed.suggested_title ?? 'Untitled',
    suggested_category: CATEGORIES.includes(parsed.suggested_category) ? parsed.suggested_category : null,
    extracted_text: String(parsed.extracted_text ?? '').slice(0, MAX_DIGEST_CHARS),
  }
}

function mimeFromExt(ext: string): string {
  return ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            doc: 'application/msword', txt: 'text/plain' } as Record<string, string>)[ext] ?? 'application/octet-stream'
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
  if (matches.length > 0) return matches.map(m => m[1]).join(' ').replace(/\s+/g, ' ').trim()
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const block = content.find((b: any) => b?.type === 'text')
  return block?.text ?? ''
}

// A naive greedy regex breaks the moment Claude adds trailing commentary
// containing a brace. Scan from the first "{" and track brace depth
// (ignoring braces inside strings) to find the exact matching close brace.
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
