import { readCharacterDocument } from './character-storage.js'
import { readConversationIndex, resolvedCharacterIds } from './chat-storage.js'
import { isValidConversationId } from './conversation-id.js'
import {
  listLorebookIds,
  readLorebooksIndexSummary,
  writeLorebook,
  type Lorebook,
} from './lorebook-file.js'
import { allocateShortId } from './short-id.js'

export const DEFAULT_NAME_TEMPLATE = '${conversationTitle}-summary'
const MAX_LOREBOOK_NAME_LEN = 120

/** 自动建书名称模板可用占位符（${key}，非提示词宏） */
export const AUTO_LOREBOOK_TEMPLATE_VAR_KEYS = [
  'conversationTitle',
  'conversationId',
  'char',
] as const

export type AutoLorebookTemplateVarKey = (typeof AUTO_LOREBOOK_TEMPLATE_VAR_KEYS)[number]

export interface AutoLorebookNameVars {
  conversationTitle: string
  conversationId: string
  char: string
}

export interface EnsurePluginLorebookInput {
  conversationId: string
  nameTemplate?: string
}

export interface EnsurePluginLorebookResult {
  id: string
  name: string
  created: boolean
  lorebook: Lorebook
}

const TEMPLATE_VAR_PATTERN = /\$\{(\w+)\}/g

function resolveConversationTitle(
  idx: Awaited<ReturnType<typeof readConversationIndex>>,
): string {
  const title = idx?.title?.trim()
  if (title) return title.slice(0, 80)
  return '未命名对话'
}

async function resolvePrimaryCharacterName(
  idx: Awaited<ReturnType<typeof readConversationIndex>>,
): Promise<string> {
  if (!idx) return ''
  const firstId = resolvedCharacterIds(idx)[0]
  if (!firstId) return ''
  const doc = await readCharacterDocument(firstId)
  if (!doc?.card || typeof doc.card !== 'object') return ''
  const nameRaw = (doc.card as Record<string, unknown>).name
  if (typeof nameRaw !== 'string' || !nameRaw.trim()) return ''
  return nameRaw.trim().slice(0, 80)
}

export function resolveAutoLorebookName(
  template: string,
  vars: AutoLorebookNameVars,
): string {
  const title = vars.conversationTitle.trim() || '未命名对话'
  const values: Record<AutoLorebookTemplateVarKey, string> = {
    conversationTitle: title,
    conversationId: vars.conversationId.trim(),
    char: vars.char.trim(),
  }
  const tpl = template.trim() || DEFAULT_NAME_TEMPLATE
  const raw = tpl.replace(TEMPLATE_VAR_PATTERN, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key as AutoLorebookTemplateVarKey]
    }
    return match
  })
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) return `${title}-summary`
  return name.length > MAX_LOREBOOK_NAME_LEN
    ? name.slice(0, MAX_LOREBOOK_NAME_LEN)
    : name
}

function clipLorebookName(name: string): string {
  return name.length > MAX_LOREBOOK_NAME_LEN
    ? name.slice(0, MAX_LOREBOOK_NAME_LEN)
    : name
}

/** 模板解析名重名时优先追加当前对话 id，仍冲突再随机短 id */
export function pickUniqueLorebookName(
  baseName: string,
  existingNames: Set<string>,
  conversationId: string,
): string {
  const clippedBase = clipLorebookName(baseName)
  if (!existingNames.has(clippedBase)) return clippedBase

  const convId = conversationId.trim()
  if (convId) {
    const withConv = clipLorebookName(`${clippedBase}-${convId}`)
    if (!existingNames.has(withConv)) return withConv
  }

  for (let i = 0; i < 32; i++) {
    const suffix = allocateShortId(new Set())
    const candidate = clipLorebookName(`${clippedBase}-${suffix}`)
    if (!existingNames.has(candidate)) return candidate
  }
  return clipLorebookName(`${clippedBase}-${Date.now().toString(36)}`)
}

function buildEmptyLorebook(id: string, name: string): Lorebook {
  const t = new Date().toISOString()
  const groupId = `group-${allocateShortId(new Set())}`
  return {
    id,
    name,
    groups: [{ id: groupId, name: 'Default group', order: 0 }],
    entries: [],
    createdAt: t,
    updatedAt: t,
  }
}

export async function ensurePluginLorebook(
  input: EnsurePluginLorebookInput,
): Promise<EnsurePluginLorebookResult | null> {
  const conversationId = input.conversationId.trim()
  if (!isValidConversationId(conversationId)) return null

  const idx = await readConversationIndex(conversationId)
  if (!idx) return null

  const title = resolveConversationTitle(idx)
  const char = await resolvePrimaryCharacterName(idx)
  const baseName = resolveAutoLorebookName(input.nameTemplate ?? DEFAULT_NAME_TEMPLATE, {
    conversationTitle: title,
    conversationId,
    char,
  })

  const summaries = await readLorebooksIndexSummary()
  const nameSet = new Set(summaries.map((s) => s.name))
  const lorebookName = pickUniqueLorebookName(baseName, nameSet, conversationId)

  const usedIds = new Set(await listLorebookIds())
  const lorebookId = allocateShortId(usedIds)
  const lorebook = buildEmptyLorebook(lorebookId, lorebookName)
  await writeLorebook(lorebook)

  return {
    id: lorebook.id,
    name: lorebook.name,
    created: true,
    lorebook,
  }
}
