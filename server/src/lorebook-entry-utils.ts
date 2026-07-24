import type {
  LorebookEntry,
  LorebookEntryPosition,
  LorebookTriggerMode,
} from './lorebook-types.js'
import { lorebookEntryKeysCorpusAppendix } from './lorebook-vector-key-rerank.js'

/** 读盘兼容：无 triggerMode 时由 constant 推断 */
export function resolveEntryTriggerMode(
  e: Pick<LorebookEntry, 'constant' | 'triggerMode'>,
): LorebookTriggerMode {
  const m = e.triggerMode
  if (m === 'keyword' || m === 'constant' || m === 'vector') return m
  return e.constant ? 'constant' : 'keyword'
}

/** 缺省 after_char（与 ST / DOC/27 一致） */
export function resolveEntryPosition(
  e: Pick<LorebookEntry, 'position'>,
): LorebookEntryPosition {
  return e.position === 'before_char' ? 'before_char' : 'after_char'
}

export function normalizeEntryPosition(
  raw: unknown,
): LorebookEntryPosition | undefined {
  if (raw === 'before_char' || raw === 'after_char') return raw
  return undefined
}

/**
 * 向量 / FTS 索引语料：标题 + 正文 + keys 低权重附录。
 * keys 仅在已有 title/content 时追加一行 `Keywords: …`；改语料后须重建该资料库索引。
 */
export function lorebookEntryEmbeddingCorpus(e: LorebookEntry): string {
  const title = e.title.trim()
  const content = e.content.trim()
  const base = title && content ? `${title}\n\n${content}` : title || content
  if (!base) return ''
  const keysPart = lorebookEntryKeysCorpusAppendix(e.keys ?? [])
  if (!keysPart) return base
  return `${base}\n\n${keysPart}`
}

export function entryNeedsKeywordWarning(e: LorebookEntry): boolean {
  return (
    resolveEntryTriggerMode(e) === 'keyword' &&
    !e.keys.some((k) => k.trim().length > 0)
  )
}

export function normalizeEntryTriggerFields(
  e: LorebookEntry,
): LorebookEntry {
  const mode = resolveEntryTriggerMode(e)
  const position = resolveEntryPosition(e)
  return {
    ...e,
    triggerMode: mode,
    constant: mode === 'constant',
    position,
  }
}
