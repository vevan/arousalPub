/** 角色卡字段切片，供 Phase A 宏读取（首绑卡 / persona） */

export interface MacroCharacterFields {
  description: string
  personality: string
  scenario: string
  firstMes: string
  mesExample: string
  creatorNotes: string
  characterVersion: string
  systemPrompt: string
  postHistoryInstructions: string
  alternateGreetings: string[]
  depthPrompt: string
}

function strField(o: Record<string, unknown>, key: string): string {
  const v = o[key]
  return typeof v === 'string' ? v : ''
}

function alternateGreetingsFromCard(o: Record<string, unknown>): string[] {
  const raw = o.alternate_greetings
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

function depthPromptFromExtensions(extensions: Record<string, unknown>): string {
  const dp = extensions.depth_prompt
  if (typeof dp === 'string' && dp.trim()) return dp.trim()
  if (dp && typeof dp === 'object' && !Array.isArray(dp)) {
    const prompt = (dp as Record<string, unknown>).prompt
    if (typeof prompt === 'string' && prompt.trim()) return prompt.trim()
  }
  return ''
}

/** 从 Tavern V2 卡 JSON 提取宏可用字段 */
export function extractMacroCharacterFields(
  card: Record<string, unknown>,
): MacroCharacterFields {
  let extensions: Record<string, unknown> = {}
  const extRaw = card.extensions
  if (extRaw && typeof extRaw === 'object' && !Array.isArray(extRaw)) {
    extensions = extRaw as Record<string, unknown>
  }
  return {
    description: strField(card, 'description').trim(),
    personality: strField(card, 'personality').trim(),
    scenario: strField(card, 'scenario').trim(),
    firstMes: strField(card, 'first_mes').trim(),
    mesExample: strField(card, 'mes_example').trim(),
    creatorNotes: strField(card, 'creator_notes').trim(),
    characterVersion: strField(card, 'character_version').trim() || '2.0',
    systemPrompt: strField(card, 'system_prompt').trim(),
    postHistoryInstructions: strField(card, 'post_history_instructions').trim(),
    alternateGreetings: alternateGreetingsFromCard(card),
    depthPrompt: depthPromptFromExtensions(extensions),
  }
}

/** {{charFirstMessage}} / `::index`：0 → first_mes，n≥1 → alternate_greetings[n-1] */
export function resolveCharFirstMessage(
  fields: MacroCharacterFields | undefined,
  indexRaw: unknown,
): string {
  if (!fields) return ''
  if (indexRaw === undefined || indexRaw === null || indexRaw === '') {
    return fields.firstMes
  }
  const n = Number.parseInt(String(indexRaw), 10)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return fields.firstMes
  return fields.alternateGreetings[n - 1] ?? ''
}
