import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { respond } from '../_shared/respond.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { callClaude, extractText, extractJsonObject } from '../_shared/claude.ts'
import { mimeFromExt, toBase64, extractDocxText } from '../_shared/fileParsing.ts'
import { CORS } from '../_shared/cors.ts'

const MAX_DIGEST_CHARS = 6000
const CATEGORIES = ['methodologies', 'technical_proposals', 'cvs', 'references', 'donor_requirements', 'templates']

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

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

  // No beta header needed for base64 PDF document blocks on current models.
  // maxTokens is generous (8000, not the previous 3000) and thinking/effort
  // are pinned explicitly because claude-sonnet-5 runs adaptive thinking by
  // default when `thinking` is omitted — those tokens count against
  // max_tokens, so a low cap risked stop_reason "max_tokens" with no JSON
  // ever written (see analyze-tor for the full diagnosis of this pattern).
  const data = await callClaude({
    apiKey, model: 'claude-sonnet-5', maxTokens: 8000,
    thinking: { type: 'adaptive' }, effort: 'low',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) } },
        { type: 'text', text: prompt },
      ],
    }],
  })

  const rawText = extractText(data.content)
  const jsonStr = extractJsonObject(rawText)
  if (!jsonStr) {
    console.error('[analyze-kb-document] no balanced JSON object found — stop_reason:', data.stop_reason, rawText.slice(0, 1000))
    throw new Error(data.stop_reason === 'max_tokens'
      ? 'AI response was truncated before it finished — try a shorter document'
      : 'AI did not return structured data — try a different file')
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

