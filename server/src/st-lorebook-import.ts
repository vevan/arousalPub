/**
 * SillyTavern World Info / Lorebook JSON → arousalPub Lorebook。
 */

import { pickUniqueLorebookName } from './plugin-lorebook-ensure.js'
import { readLorebooksIndexSummary } from './lorebook-file.js'
import type { Lorebook, LorebookEntry, LorebookTriggerMode } from './lorebook-types.js'
import { allocateShortId } from './short-id.js'

export const ST_LOREBOOK_GROUP_ID = 'group-default'

export interface StLorebookEntry {
  uid?: number
  key?: string[]
  keysecondary?: string[]
  comment?: string
  content?: string
  constant?: boolean
  vectorized?: boolean
  disable?: boolean
  order?: number
  priority?: number
}

export interface StLorebookJson {
  entries?: Record<string, StLorebookEntry>
  name?: string
  stlo?: unknown
}

export interface StLorebookPreview {
  name: string
  entryCount: number
  vectorEntryCount: number
  disabledCount: number
  warnings: string[]
}

export interface ConvertStLorebookOptions {
  lorebookId?: string
  name?: string
  /** 用于重名时追加后缀 */
  conversationId?: string
}

/** ST 导入条目上限（与 bulk PUT 的 3000 对齐） */
export const ST_LOREBOOK_IMPORT_MAX_ENTRIES = 3000

export function isStLorebookJson(raw: unknown): raw is StLorebookJson {
  if (!raw || typeof raw !== 'object') return false
  const entries = (raw as StLorebookJson).entries
  if (entries == null || typeof entries !== 'object' || Array.isArray(entries))
    return false
  const vals = Object.values(entries)
  if (vals.length === 0) return true
  return vals.some((v) => v != null && typeof v === 'object')
}

function resolveStEntryTriggerMode(entry: StLorebookEntry): LorebookTriggerMode {
  if (entry.constant === true) return 'constant'
  const keys = Array.isArray(entry.key) ? entry.key.filter((k) => typeof k === 'string' && k.trim()) : []
  if (keys.length === 0 && entry.vectorized === true) return 'vector'
  return 'keyword'
}

function resolveStEntryTitle(entry: StLorebookEntry, uidKey: string): string {
  const comment = typeof entry.comment === 'string' ? entry.comment.trim() : ''
  if (comment) return comment
  const content = typeof entry.content === 'string' ? entry.content.trim() : ''
  if (content) return content.slice(0, 80)
  return `entry-${uidKey}`
}

function sortedStEntries(st: StLorebookJson): { uidKey: string; entry: StLorebookEntry }[] {
  const entries = st.entries ?? {}
  return Object.entries(entries)
    .map(([uidKey, entry]) => ({ uidKey, entry }))
    .sort((a, b) => {
      const ao = typeof a.entry.order === 'number' ? a.entry.order : Number.parseInt(a.uidKey, 10)
      const bo = typeof b.entry.order === 'number' ? b.entry.order : Number.parseInt(b.uidKey, 10)
      const an = Number.isFinite(ao) ? ao : 0
      const bn = Number.isFinite(bo) ? bo : 0
      if (an !== bn) return an - bn
      return a.uidKey.localeCompare(b.uidKey, undefined, { numeric: true })
    })
}

export function previewStLorebookImport(st: StLorebookJson): StLorebookPreview {
  const warnings: string[] = []
  const sorted = sortedStEntries(st)
  let vectorEntryCount = 0
  let disabledCount = 0
  for (const { entry } of sorted) {
    const mode = resolveStEntryTriggerMode(entry)
    if (mode === 'vector') vectorEntryCount++
    if (entry.disable === true) disabledCount++
    if (typeof entry.content !== 'string') {
      warnings.push(`条目缺少 content（uid ${entry.uid ?? '?'})`)
    }
  }
  const rawName = typeof st.name === 'string' ? st.name.trim() : ''
  const name = rawName || 'ST 世界书'
  if (st.stlo != null) {
    warnings.push('已忽略 ST 全局 stlo 预算设置')
  }
  return {
    name,
    entryCount: sorted.length,
    vectorEntryCount,
    disabledCount,
    warnings,
  }
}

export async function convertStLorebookToLorebook(
  st: StLorebookJson,
  options: ConvertStLorebookOptions = {},
): Promise<Lorebook> {
  const preview = previewStLorebookImport(st)
  const sorted = sortedStEntries(st)
  if (sorted.length > ST_LOREBOOK_IMPORT_MAX_ENTRIES) {
    throw new Error(
      `ST 世界书条目数 ${sorted.length} 超过导入上限 ${ST_LOREBOOK_IMPORT_MAX_ENTRIES}`,
    )
  }
  const used = new Set<string>()
  const lorebookId = options.lorebookId?.trim() || `lore-${allocateShortId(used)}`
  used.add(lorebookId)

  const indexSummary = await readLorebooksIndexSummary()
  const existingNames = new Set(indexSummary.map((e) => e.name))
  const baseName = (options.name?.trim() || preview.name).trim() || 'ST 世界书'
  const name = pickUniqueLorebookName(
    baseName,
    existingNames,
    options.conversationId?.trim() ?? '',
  )

  const t = new Date().toISOString()
  const entries: LorebookEntry[] = sorted.map(({ uidKey, entry }, index) => {
    const triggerMode = resolveStEntryTriggerMode(entry)
    const keys = Array.isArray(entry.key)
      ? entry.key.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      : []
    const order =
      typeof entry.order === 'number' && Number.isFinite(entry.order)
        ? entry.order
        : index
    const priority =
      typeof entry.priority === 'number' && Number.isFinite(entry.priority)
        ? entry.priority
        : 0
    return {
      id: `entry-${allocateShortId(used)}`,
      groupId: ST_LOREBOOK_GROUP_ID,
      title: resolveStEntryTitle(entry, uidKey),
      content: typeof entry.content === 'string' ? entry.content : '',
      enabled: entry.disable !== true,
      order,
      keys,
      constant: triggerMode === 'constant',
      triggerMode,
      priority,
      createdAt: t,
      updatedAt: t,
    }
  })

  return {
    id: lorebookId,
    name,
    description: 'Imported from SillyTavern World Info',
    groups: [
      {
        id: ST_LOREBOOK_GROUP_ID,
        name: 'Default',
        order: 0,
        description: 'ST 导出条目（单组）',
      },
    ],
    entries,
    createdAt: t,
    updatedAt: t,
  }
}
