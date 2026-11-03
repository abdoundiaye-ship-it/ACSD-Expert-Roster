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
// Lite: ~1-2s on real prompts and stays available when the full Flash models
// return 503 "high demand" on the free tier (measured 2026-11-03).
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const GEMINI_MIN_TIMEOUT_MS = 90_000
// Edge Functions are cut off at ~150s; keep the primary + fallback pair inside it.
const FUNCTION_BUDGET_MS = 140_000
const MIN_FALLBACK_MS = 15_000

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
  const primary = (Deno.env.get('LLM_PROVIDER') ?? 'anthropic').toLowerCase() === 'gemini' ? 'gemini' : 'anthropic'
  // LLM_FALLBACK_MODEL (Gemini primary only): fall back to a second Gemini
  // model instead of Claude. Free-tier quotas are counted per model, so a
  // lighter model usually still has quota when the main one is exhausted —
  // a zero-cost fallback for projects without Anthropic API credit.
  const fallbackModel = primary === 'gemini' ? Deno.env.get('LLM_FALLBACK_MODEL') || null : null
  const secondary = primary === 'gemini' && !fallbackModel ? 'anthropic' : 'gemini'
  const secondaryLabel = fallbackModel ? `gemini (${fallbackModel})` : secondary

  // Automatic fallback: if the primary provider fails for any reason (quota
  // or credit exhausted, overload, outage, timeout, auth), retry the call ONCE
  // on the other provider — but only if that provider is configured, and
  // unless LLM_FALLBACK=false. When a fallback exists the primary makes a
  // single attempt: on the free tier a busy model answers 503 "high demand"
  // after 7–17s each time, so retrying it only delays the fallback (and three
  // back-to-back timeouts would blow past the ~150s Edge Function limit).
  const fallbackOn = Deno.env.get('LLM_FALLBACK') !== 'false'
  const secondaryReady = secondary === 'gemini' ? !!Deno.env.get('GEMINI_API_KEY') : !!apiKey
  // A fallback model identical to the primary would just repeat the failure.
  const sameModel = !!fallbackModel && fallbackModel === (Deno.env.get('LLM_MODEL') || GEMINI_DEFAULT_MODEL)
  const canFallback = fallbackOn && secondaryReady && !sameModel

  // Thinking Gemini models (e.g. gemini-3.8-flash) can take 30s+ even for
  // trivial prompts, so Gemini gets a floor above the shorter per-caller
  // timeouts (scan uses 25s).
  const providerTimeout = (p: 'anthropic' | 'gemini') => p === 'gemini' ? Math.max(timeoutMs, GEMINI_MIN_TIMEOUT_MS) : timeoutMs

  const run = (provider: 'anthropic' | 'gemini', timeout: number, attempts: number, retryTimeouts: boolean, geminiModel?: string) => provider === 'gemini'
    ? callGemini({ messages, system, maxTokens, timeoutMs: timeout, retries: attempts, retryTimeouts, model: geminiModel })
    : callAnthropic({ apiKey, model, maxTokens, messages, system, extraHeaders, timeoutMs: timeout, retries: attempts, thinking, effort, retryTimeouts })

  const startedAt = Date.now()
  try {
    return await run(primary, providerTimeout(primary), canFallback ? 0 : retries, !canFallback)
  } catch (primaryErr) {
    if (!canFallback) throw primaryErr
    const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
    // The fallback only gets what's left of the function's time budget.
    const remaining = FUNCTION_BUDGET_MS - (Date.now() - startedAt)
    if (remaining < MIN_FALLBACK_MS) {
      throw new Error(`${primaryMsg} — no time left to fall back to ${secondaryLabel}`)
    }
    console.warn(`[callClaude] ${primary} failed, falling back to ${secondaryLabel}: ${primaryMsg.slice(0, 300)}`)
    try {
      const res = await run(secondary, Math.min(providerTimeout(secondary), remaining), retries, false, fallbackModel ?? undefined)
      return { ...res, fallback_from: primary }
    } catch (secondaryErr) {
      const secondaryMsg = secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr)
      throw new Error(`${primaryMsg} — fallback to ${secondaryLabel} also failed: ${secondaryMsg}`)
    }
  }
}

async function callAnthropic(args: {
  apiKey: string; model: string; maxTokens: number; messages: ClaudeMessage[]; system?: string
  extraHeaders?: Record<string, string>; timeoutMs: number; retries: number
  thinking?: CallClaudeOptions['thinking']; effort?: CallClaudeOptions['effort']; retryTimeouts: boolean
}): Promise<any> {
  const { apiKey, model, maxTokens, messages, system, extraHeaders, timeoutMs, retries, thinking, effort, retryTimeouts } = args
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

      if (res.ok) return { ...(await res.json()), provider: 'anthropic' }

      const errText = (await res.text()).slice(0, 400)
      lastErr = new Error(`Claude API error (${res.status}): ${errText}`)
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt === retries) throw markFatal(lastErr)
    } catch (err) {
      clearTimeout(timer)
      if (isFatal(err)) throw err // a 4xx won't succeed by resending it
      const timedOut = err instanceof Error && err.name === 'AbortError'
      if (timedOut) {
        lastErr = new Error(`Claude API request timed out after ${timeoutMs}ms`)
      } else if (err instanceof Error) {
        lastErr = err
      }
      if (attempt === retries || (timedOut && !retryTimeouts)) throw lastErr
    }
    await new Promise(r => setTimeout(r, 500 * (attempt + 1))) // brief backoff before retrying
  }

  throw lastErr
}

// ── Google Gemini adapter (free tier) ────────────────────────────────────────
// Translates the Claude-shaped request to Gemini's generateContent API and
// normalises the reply back to the Claude shape. Reads GEMINI_API_KEY (a free
// Google AI Studio key); model from LLM_MODEL, defaulting to GEMINI_DEFAULT_MODEL.
// Handles both plain-text messages and the document+text arrays the CV/TOR/KB
// callers send (mapped to Gemini inline_data). Mirrors callClaude's
// timeout/retry contract and throws the same error shapes.
async function callGemini(args: {
  messages: ClaudeMessage[]; system?: string; maxTokens: number; timeoutMs: number; retries: number; retryTimeouts: boolean
  model?: string
}): Promise<any> {
  const { messages, system, maxTokens, timeoutMs, retries, retryTimeouts } = args
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('LLM_PROVIDER=gemini but GEMINI_API_KEY is not configured on this project')
  const model = args.model || Deno.env.get('LLM_MODEL') || GEMINI_DEFAULT_MODEL

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
    // Current Gemini flash models allow 65,536 output tokens, and their
    // "thinking" draws on the same allowance — so add headroom on top of
    // what the caller needs for its answer (the old 8192 cap could truncate
    // analyze-tor's 16k-token JSON, or leave a 2k CV extraction nothing
    // after thinking).
    generationConfig: { maxOutputTokens: Math.min(maxTokens + 16_000, 65_536), temperature: 0 },
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
      if (!retryable || attempt === retries) throw markFatal(lastErr)
    } catch (err) {
      clearTimeout(timer)
      if (isFatal(err)) throw err
      const timedOut = err instanceof Error && err.name === 'AbortError'
      if (timedOut) {
        lastErr = new Error(`Gemini API request timed out after ${timeoutMs}ms`)
      } else if (err instanceof Error) {
        lastErr = err
      }
      if (attempt === retries || (timedOut && !retryTimeouts)) throw lastErr
    }
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
  }
  throw lastErr
}

// Marks an error raised inside a provider's retry loop as final, so the
// loop's own catch rethrows it instead of retrying (it used to swallow the
// "don't retry a 4xx" throw and resend the request anyway).
function markFatal(err: Error): Error {
  return Object.assign(err, { fatal: true })
}
function isFatal(err: unknown): boolean {
  return err instanceof Error && (err as Error & { fatal?: boolean }).fatal === true
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
