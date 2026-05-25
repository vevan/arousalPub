/** 与 server/src/prompt-xml.ts 对齐：仅角色卡字段、世界书正文做 XML 转义与包裹 */

/**
 * 组装时未注入内容的占位（自闭合标签，避免被 `{{macro}}` 管线当作宏）。
 * 与 server/src/prompt-xml.ts 中 ASSEMBLE_INJECT_PLACEHOLDER 保持一致。
 */
export const ASSEMBLE_INJECT_PLACEHOLDER = {
  characterCard: '<inject slot="character_card" />',
  lorebook: '<inject slot="lorebook" />',
  chatHistory: '<inject slot="chat_history" />',
  userInput: '<inject slot="user_input" />',
  boundCharacterSystem: '<inject slot="bound_character.system_prompt" />',
  boundCharacterPostHistory:
    '<inject slot="bound_character.post_history_instructions" />',
} as const

export function escapeXmlText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const CARD_TEXT_FIELDS = [
  ['name', 'name'],
  ['description', 'description'],
  ['personality', 'personality'],
  ['scenario', 'scenario'],
  ['mes_example', 'mes_example'],
  ['first_mes', 'first_mes'],
  ['creator_notes', 'creator_notes'],
] as const

function el(tag: string, text: string): string {
  return `  <${tag}>${escapeXmlText(text)}</${tag}>`
}

export function cardRecordToCharXmlBlock(card: Record<string, unknown>): string {
  const nameRaw = card.name
  const display =
    typeof nameRaw === 'string' && nameRaw.trim()
      ? nameRaw.trim()
      : '角色'
  const attr = escapeXmlText(display)
  const lines: string[] = []
  for (const [tag, ck] of CARD_TEXT_FIELDS) {
    const v = card[ck]
    if (typeof v !== 'string' || !v.trim()) continue
    lines.push(el(tag, v.trim()))
  }
  if (lines.length === 0) {
    lines.push(el('description', '(No description)'))
  }
  return `<char name="${attr}">\n${lines.join('\n')}\n</char>`
}

export function loreTextToXmlBlock(text: string): string {
  const t = text.trim()
  if (!t) return ''
  return `<lore>\n${escapeXmlText(t)}\n</lore>`
}
