import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { respond } from '../_shared/respond.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { callClaude, extractText, extractJsonObject } from '../_shared/claude.ts'
import { CORS } from '../_shared/cors.ts'

// The "AI Secretary": takes raw notes/a rough transcript an admin typed
// during or after a real meeting and structures it into a summary,
// decisions, and action items. There is no audio capture or transcription
// here — the human still writes the notes, same as the paste-intake flow
// already used for opportunities and knowledge-base documents. This keeps
// the AI's job to extraction/structuring, not to inventing what was said.
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return respond({ error: 'Method Not Allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  let body: { raw_notes?: string }
  try { body = await req.json() }
  catch { return respond({ error: 'Invalid JSON body' }, 400) }

  const rawNotes = (body.raw_notes ?? '').trim()
  if (!rawNotes) return respond({ error: 'raw_notes is required' }, 400)
  if (rawNotes.length < 20) return respond({ error: 'raw_notes is too short to summarize meaningfully' }, 400)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured on this project' }, 500)

  const prompt = buildPrompt(rawNotes)

  let claudeData: any
  try {
    claudeData = await callClaude({
      apiKey, model: 'claude-sonnet-5', maxTokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    return respond({ error: err instanceof Error ? err.message : 'Claude API call failed' }, 502)
  }

  const rawText = extractText(claudeData.content)
  const jsonStr = extractJsonObject(rawText)
  if (!jsonStr) {
    console.error('[analyze-meeting-notes] no balanced JSON object found', rawText.slice(0, 1000))
    return respond({ error: 'AI did not return structured data — try again' }, 500)
  }

  let parsed: { summary?: string; decisions?: unknown; action_items?: unknown }
  try {
    parsed = JSON.parse(jsonStr)
  } catch (err) {
    console.error('[analyze-meeting-notes] failed to parse JSON', err instanceof Error ? err.message : err, jsonStr.slice(0, 1000))
    return respond({ error: 'Could not parse AI response as JSON' }, 500)
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions.filter((d): d is string => typeof d === 'string') : []
  const actionItems = Array.isArray(parsed.action_items)
    ? parsed.action_items
        .filter((a): a is Record<string, unknown> => a != null && typeof a === 'object')
        .map(a => ({
          description: typeof a.description === 'string' ? a.description : '',
          suggested_assignee: typeof a.suggested_assignee === 'string' ? a.suggested_assignee : null,
        }))
        .filter(a => a.description)
    : []

  return respond({ success: true, summary, decisions, action_items: actionItems })
})

function buildPrompt(rawNotes: string): string {
  return `Tu es l'assistant secrétaire d'ACSD, un cabinet de conseil ouest-africain. Un membre de l'équipe a pris des notes brutes (ou une transcription approximative) pendant ou juste après une réunion. Ta tâche : structurer UNIQUEMENT ce qui est réellement présent dans ces notes — ne jamais inventer un fait, une décision ou une action qui n'y figure pas.

Réponds dans la même langue que les notes ci-dessous (français ou anglais selon la langue dominante des notes).

Notes brutes :
"""
${rawNotes}
"""

Retourne UNIQUEMENT un objet JSON valide (pas de markdown, pas d'explication) :

{
  "summary": "résumé de 2 à 5 phrases de ce qui a été discuté, dans la langue des notes",
  "decisions": ["liste des décisions explicitement actées pendant la réunion — vide si aucune décision claire n'apparaît"],
  "action_items": [
    { "description": "action concrète à réaliser, formulée comme une tâche", "suggested_assignee": "nom de la personne responsable si mentionné dans les notes, sinon null" }
  ]
}

Si les notes ne permettent pas d'identifier de décisions ou d'actions, retourne des tableaux vides plutôt que d'en inventer. Return ONLY the JSON object.`
}
