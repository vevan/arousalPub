/**
 * 组装时未注入内容的占位（自闭合标签，避免被 `{{macro}}` 管线当作宏）。
 */
export const ASSEMBLE_INJECT_PLACEHOLDER = {
  characterCard: '<inject slot="character_card" />',
  lorebook: '<inject slot="lorebook" />',
  chatHistory: '<inject slot="chat_history" />',
  userInput: '<inject slot="user_input" />',
  memory: '<inject slot="memory" />',
  boundCharacterSystem: '<inject slot="bound_character.system_prompt" />',
  boundUserPersona: '<inject slot="user_persona" />',
  boundCharDescription: '<inject slot="bound_character.description" />',
  boundCharPersonality: '<inject slot="bound_character.personality" />',
  boundScenario: '<inject slot="bound_character.scenario" />',
  boundDialogueExamples: '<inject slot="bound_character.mes_example" />',
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

/** 元素正文写入 XML 前：还原误存实体（最多 3 轮），供正则等处理与 {@link prepareXmlElementText} 对齐。 */
export function normalizeXmlTextBeforeProcessing(raw: string): string {
  let s = raw
  for (let i = 0; i < 3; i++) {
    const next = decodeXmlEntitiesOnce(s)
    if (next === s) break
    s = next
  }
  return s
}

/**
 * 元素正文：先还原历史误存的实体（最多 3 轮），再 escape，避免 &quot; → &amp;quot; 叠层。
 */
export function prepareXmlElementText(raw: string): string {
  return escapeXmlElementText(normalizeXmlTextBeforeProcessing(raw))
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

export type LoreXmlEntry = { name: string; content: string }

export type LorebookXmlGroup = {
  lorebookName: string
  entries: LoreXmlEntry[]
}

function formatLoreEntryLines(
  entries: LoreXmlEntry[],
  indent: string,
): string[] {
  const lines: string[] = []
  for (const e of entries) {
    const name = e.name.trim() || '未命名'
    const body = e.content.trim()
    if (!body) continue
    lines.push(`${indent}<lore name="${escapeXmlAttribute(name)}">`)
    for (const line of body.split('\n')) {
      lines.push(`${indent}  ${prepareXmlElementText(line)}`)
    }
    lines.push(`${indent}</lore>`)
  }
  return lines
}

/**
 * 命中条目 → `<lores>` 块（每条 `<lore name="标题">` + 正文，正文按行转义）。
 */
export function formatLoresXmlBlock(entries: LoreXmlEntry[]): string {
  if (entries.length === 0) return ''
  const inner = formatLoreEntryLines(entries, '  ')
  if (inner.length === 0) return ''
  return ['<lores>', ...inner, '</lores>'].join('\n')
}

/**
 * 多本资料库绑定：按书分组 `<lorebook name="显示名">` + 内层 `<lore>`。
 */
export function formatLoresXmlGroupedBlock(groups: LorebookXmlGroup[]): string {
  const nonEmpty = groups
    .map((g) => ({
      lorebookName: g.lorebookName.trim() || '未命名',
      entries: g.entries.filter((e) => e.content.trim().length > 0),
    }))
    .filter((g) => g.entries.length > 0)
  if (nonEmpty.length === 0) return ''
  const lines: string[] = ['<lores>']
  for (const g of nonEmpty) {
    lines.push(`  <lorebook name="${escapeXmlAttribute(g.lorebookName)}">`)
    lines.push(...formatLoreEntryLines(g.entries, '    '))
    lines.push('  </lorebook>')
  }
  lines.push('</lores>')
  return lines.join('\n')
}

/**
 * 单本扁平 / 多本分组：由 resolve 按绑定数量选择。
 */
export function formatLoresInjectionXml(groups: LorebookXmlGroup[]): string {
  const nonEmpty = groups.filter((g) =>
    g.entries.some((e) => e.content.trim().length > 0),
  )
  if (nonEmpty.length === 0) return ''
  if (nonEmpty.length === 1) {
    return formatLoresXmlBlock(nonEmpty[0].entries)
  }
  return formatLoresXmlGroupedBlock(nonEmpty)
}

/** 合并恒定与匹配 lore 分组（按 lorebookName 合并 entries，保持恒定在前） */
export function mergeLorebookXmlGroups(
  constantGroups: LorebookXmlGroup[],
  matchedGroups: LorebookXmlGroup[],
): LorebookXmlGroup[] {
  const byName = new Map<string, LorebookXmlGroup>()
  const touch = (g: LorebookXmlGroup) => {
    const name = g.lorebookName.trim() || '未命名'
    const prev = byName.get(name)
    if (!prev) {
      byName.set(name, {
        lorebookName: name,
        entries: g.entries.map((e) => ({ ...e })),
      })
      return
    }
    const seen = new Set(prev.entries.map((e) => `${e.name}\0${e.content}`))
    for (const e of g.entries) {
      const k = `${e.name}\0${e.content}`
      if (seen.has(k)) continue
      seen.add(k)
      prev.entries.push({ ...e })
    }
  }
  for (const g of constantGroups) touch(g)
  for (const g of matchedGroups) touch(g)
  return [...byName.values()].filter((g) =>
    g.entries.some((e) => e.content.trim().length > 0),
  )
}

/** 世界书注入：已为 `<lores>` 时原样返回，否则兼容旧单块包裹 */
export function loreTextToXmlBlock(text: string): string {
  const t = text.trim()
  if (!t) return ''
  if (t.startsWith('<lores')) return t
  return `<lore>\n${prepareXmlElementText(t)}\n</lore>`
}
