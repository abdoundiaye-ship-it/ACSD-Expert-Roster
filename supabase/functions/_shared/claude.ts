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
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_RETRIES = 2

// Retries only on network-level failures, timeouts, 429, and 5xx — never
// on 4xx client errors (a bad request won't succeed just by resending it).
export async function callClaude(opts: CallClaudeOptions): Promise<any> {
  const {
    apiKey, model, maxTokens, messages, system, extraHeaders,
    timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES,
  } = opts

  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages }
  if (system) body.system = system

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
