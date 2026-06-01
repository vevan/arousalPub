/**
 * 组装时未注入内容的占位（自闭合标签，避免被 `{{macro}}` 管线当作宏）。
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

/** XML 属性值：须转义引号，避免破坏 `name="…"` 等结构。 */
export function escapeXmlAttribute(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** XML 元素正文：仅转义结构字符；引号在文本节点中合法，勿转成 &quot;。 */
export function escapeXmlElementText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeXmlEntitiesOnce(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/**
 * 元素正文：先还原历史误存的实体（最多 3 轮），再 escape，避免 &quot; → &amp;quot; 叠层。
 */
export function prepareXmlElementText(raw: string): string {
  let s = raw
  for (let i = 0; i < 3; i++) {
    const next = decodeXmlEntitiesOnce(s)
    if (next === s) break
    s = next
  }
  return escapeXmlElementText(s)
}

/** @deprecated 使用 escapeXmlAttribute / prepareXmlElementText */
export function escapeXmlText(raw: string): string {
  return escapeXmlAttribute(raw)
}

const CARD_TEXT_FIELDS = [
  ['name', 'name'],
  ['description', 'description'],
  ['personality', 'personality'],
  ['scenario', 'scenario'],
  ['mes_example', 'mes_example'],
  ['creator_notes', 'creator_notes'],
] as const

function el(tag: string, text: string): string {
  return `  <${tag}>${prepareXmlElementText(text)}</${tag}>`
}

/**
 * 单张角色卡 → `<char name="...">` 片段（字段级转义后再拼接，不做宏替换）。
 */
export function cardRecordToCharXmlBlock(card: Record<string, unknown>): string {
  return cardRecordToPersonaXmlBlock(card, 'char')
}

function cardRecordToPersonaXmlBlock(
  card: Record<string, unknown>,
  rootTag: 'char' | 'user',
): string {
  const nameRaw = card.name
  const display =
    typeof nameRaw === 'string' && nameRaw.trim()
      ? nameRaw.trim()
      : rootTag === 'user'
        ? '用户'
        : '角色'
  const attr = escapeXmlAttribute(display)
  const lines: string[] = []
  for (const [tag, ck] of CARD_TEXT_FIELDS) {
    const v = card[ck]
    if (typeof v !== 'string' || !v.trim()) continue
    lines.push(el(tag, v.trim()))
  }
  if (lines.length === 0) {
    lines.push(el('description', '(No description)'))
  }
  return `<${rootTag} name="${attr}">\n${lines.join('\n')}\n</${rootTag}>`
}

/** 用户 persona 卡 → `<user name="…">`（与 AI 角色 `<char>` 区分） */
export function cardRecordToUserXmlBlock(card: Record<string, unknown>): string {
  return cardRecordToPersonaXmlBlock(card, 'user')
}

/**
 * 命中条目 → `<lores>` 块（每条 `<lore name="标题">` + 正文，正文按行转义）。
 */
export function formatLoresXmlBlock(
  entries: Array<{ name: string; content: string }>,
): string {
  if (entries.length === 0) return ''
  const lines: string[] = ['<lores>']
  for (const e of entries) {
    const name = e.name.trim() || '未命名'
    const body = e.content.trim()
    if (!body) continue
    lines.push(`  <lore name="${escapeXmlAttribute(name)}">`)
    for (const line of body.split('\n')) {
      lines.push(`  ${prepareXmlElementText(line)}`)
    }
    lines.push('  </lore>')
  }
  if (lines.length === 1) return ''
  lines.push('</lores>')
  return lines.join('\n')
}

/** 世界书注入：已为 `<lores>` 时原样返回，否则兼容旧单块包裹 */
export function loreTextToXmlBlock(text: string): string {
  const t = text.trim()
  if (!t) return ''
  if (t.startsWith('<lores')) return t
  return `<lore>\n${prepareXmlElementText(t)}\n</lore>`
}
