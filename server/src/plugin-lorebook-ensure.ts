import { readConversationIndex } from './chat-storage.js'
import { isValidConversationId } from './conversation-id.js'
import {
  listLorebookIds,
  readLorebooksIndexSummary,
  writeLorebook,
  type Lorebook,
} from './lorebook-file.js'
import { allocateShortId } from './short-id.js'

const DEFAULT_NAME_TEMPLATE = '{{conversationTitle}}-summary'
const MAX_LOREBOOK_NAME_LEN = 120

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

function resolveConversationTitle(
  idx: Awaited<ReturnType<typeof readConversationIndex>>,
): string {
  const title = idx?.title?.trim()
  if (title) return title.slice(0, 80)
  return '未命名对话'
}

export function resolveAutoLorebookName(
  template: string,
  conversationTitle: string,
): string {
  const raw = (template.trim() || DEFAULT_NAME_TEMPLATE).replace(
    /\{\{conversationTitle\}\}/g,
    conversationTitle.trim() || '未命名对话',
  )
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) return `${conversationTitle.trim() || '未命名对话'}-summary`
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
  const baseName = resolveAutoLorebookName(
    input.nameTemplate ?? DEFAULT_NAME_TEMPLATE,
    title,
  )

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
