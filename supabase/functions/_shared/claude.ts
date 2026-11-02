// Shared Claude API client for every Edge Function that calls it —
// centralizes the timeout/retry/error-shape contract that ~5 of these
// functions previously lacked entirely (a bare `fetch()` with no
// try/catch anywhere in the call chain, no timeout, no retry on a
// transient rate-limit or network blip).

export interface ClaudeMessage {
  role: string
  content: string | Array<Record<string, unknown>>
}

export interface CallClaudeOptions {
  apiKey: string
  model: string
  maxTokens: number
  messages: ClaudeMessage[]
  system?: string
  extraHeaders?: Record<string, string>
  timeoutMs?: number
  retries?: number
  // Opt-in only — callers on Claude Sonnet 5 / Opus-tier models where
  // omitting `thinking` now means "run adaptive thinking by default" (a
  // behavior change from older models, where omitting it meant no
  // thinking at all). Left undefined for callers on other model families
  // (e.g. Haiku 4.5, which uses the older budget_tokens shape and errors
  // on `output_config.effort`) so their request body is unchanged.
  thinking?: { type: 'adaptive' } | { type: 'disabled' }
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  // Canned text this call returns verbatim when MOCK_AI mode is on, instead
  // of hitting the Anthropic API. Each caller passes a string shaped like
  // the real response it expects (e.g. a JSON object). See the MOCK_AI gate
  // below. Only for cost-free UI testing of a project with no API credit;
  // unset MOCK_AI (or set it to anything but 'true') for real behavior.
  mock?: string
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_RETRIES = 2

// Retries only on network-level failures, timeouts, 429, and 5xx — never
// on 4xx client errors (a bad request won't succeed just by resending it).
export async function callClaude(opts: CallClaudeOptions): Promise<any> {
  const {
    apiKey, model, maxTokens, messages, system, extraHeaders,
    timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES,
    thinking, effort, mock,
  } = opts

  // MOCK_AI test mode: return the caller-supplied canned text without any
  // network call, so AI features can be exercised end-to-end on a project
  // whose Anthropic key has no credit. Shaped to look like a real Claude
  // response ({ content: [{ type:'text', text }] }) so every downstream
  // extractText/extractJsonObject path works unchanged. Gated strictly on
  // the string 'true' so it can never accidentally stay on in production.
  if (Deno.env.get('MOCK_AI') === 'true') {
    return { content: [{ type: 'text', text: mock ?? '{}' }], stop_reason: 'end_turn', mock: true }
  }

  // Provider router: when LLM_PROVIDER=gemini, route to Google Gemini's free
  // tier instead of Anthropic. The response is normalised back to the Claude
  // shape ({ content: [{ type:'text', text }] }) so every caller and the
  // extractText/extractJsonObject helpers work unchanged. Gemini is used
  // (not a text-only free API) because several callers send PDF documents,
  // which Gemini accepts as inline_data. Default stays 'anthropic'.
  if ((Deno.env.get('LLM_PROVIDER') ?? 'anthropic').toLowerCase() === 'gemini') {
    return await callGemini({ messages, system, maxTokens, timeoutMs, retries })
  }

  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages }
  if (system) body.system = system
  if (thinking) body.thinking = thinking
  if (effort) body.output_config = { effort }

  let lastErr: Error = new Error('Claude API call failed')

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (res.ok) return await res.json()

      const errText = (await res.text()).slice(0, 400)
      lastErr = new Error(`Claude API error (${res.status}): ${errText}`)
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt === retries) throw lastErr
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        lastErr = new Error(`Claude API request timed out after ${timeoutMs}ms`)
      } else if (err instanceof Error) {
        lastErr = err
      }
      if (attempt === retries) throw lastErr
    }
    await new Promise(r => setTimeout(r, 500 * (attempt + 1))) // brief backoff before retrying
  }

  throw lastErr
}

// ── Google Gemini adapter (free tier) ────────────────────────────────────────
// Translates the Claude-shaped request to Gemini's generateContent API and
// normalises the reply back to the Claude shape. Reads GEMINI_API_KEY (a free
// Google AI Studio key); model from LLM_MODEL, defaulting to gemini-3.8-flash.
// Handles both plain-text messages and the document+text arrays the CV/TOR/KB
// callers send (mapped to Gemini inline_data). Mirrors callClaude's
// timeout/retry contract and throws the same error shapes.
async function callGemini(args: {
  messages: ClaudeMessage[]; system?: string; maxTokens: number; timeoutMs: number; retries: number
}): Promise<any> {
  const { messages, system, maxTokens, retries } = args
  // gemini-3.8-flash reasons before answering (~30s even for trivial prompts),
  // so enforce a floor above the shorter per-caller timeouts (scan uses 25s).
  const timeoutMs = Math.max(args.timeoutMs, 90_000)
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('LLM_PROVIDER=gemini but GEMINI_API_KEY is not configured on this project')
  // gemini-2.0-flash was retired (404 "no longer available") — 3.8-flash is the current free-tier model.
  const model = Deno.env.get('LLM_MODEL') || 'gemini-3.8-flash'

  // Map Claude messages -> Gemini contents. Gemini uses 'model' for assistant
  // turns; these callers only send 'user' turns, but we map defensively.
  const contents = messages.map(m => {
    const parts: Record<string, unknown>[] = []
    if (typeof m.content === 'string') {
      parts.push({ text: m.content })
    } else {
      for (const block of m.content as Array<Record<string, any>>) {
        if (block.type === 'text') parts.push({ text: block.text })
        else if (block.type === 'document' && block.source?.type === 'base64') {
          parts.push({ inline_data: { mime_type: block.source.media_type, data: block.source.data } })
        }
      }
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts }
  })

  const body: Record<string, unknown> = {
    contents,
    // Gemini flash models cap output at 8192 tokens; don't request more.
    generationConfig: { maxOutputTokens: Math.min(maxTokens, 8192), temperature: 0 },
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  let lastErr: Error = new Error('Gemini API call failed')

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (res.ok) {
        const data = await res.json()
        const cand = data.candidates?.[0]
        const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
        const stop = cand?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn'
        return { content: [{ type: 'text', text }], stop_reason: stop, provider: 'gemini' }
      }

      const errText = (await res.text()).slice(0, 400)
      lastErr = new Error(`Gemini API error (${res.status}): ${errText}`)
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt === retries) throw lastErr
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        lastErr = new Error(`Gemini API request timed out after ${timeoutMs}ms`)
      } else if (err instanceof Error) {
        lastErr = err
      }
      if (attempt === retries) throw lastErr
    }
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
  }
  throw lastErr
}

// Claude's content array isn't always [textBlock] — a leading non-text
// block (e.g. extended thinking) would silently produce an empty string
// if we blindly read content[0].text. Find the actual text block instead.
export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const block = content.find((b: any) => b?.type === 'text')
  return block?.text ?? ''
}

// A naive greedy regex (first "{" to last "}") breaks the moment Claude
// adds trailing commentary containing a brace. Scan from the first "{"
// and track brace depth (ignoring braces inside strings) to find the
// exact matching close brace instead.
export function extractJsonObject(text: string): string | null {
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
