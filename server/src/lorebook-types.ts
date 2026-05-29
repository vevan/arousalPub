/** 世界书 id：字母数字、下划线、连字符，与 prompts 预设 id 规则一致 */
export const LOREBOOK_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export interface LorebookGroup {
  id: string
  name: string
  order: number
  description?: string
}

/** 条目触发方式：关键字 / 恒定 / 向量语义 */
export type LorebookTriggerMode = 'keyword' | 'constant' | 'vector'

/**
 * 世界书条目（单条 lore）。
 * 触发与注入细则后续接组装管线；框架期先落盘结构与 CRUD。
 */
export interface LorebookEntry {
  id: string
  groupId: string
  title: string
  content: string
  comment?: string
  enabled: boolean
  /** 组内排序，从 0 起 */
  order: number
  /** 关键字触发（空 = 仅依赖 constant / 后续扩展） */
  keys: string[]
  /** 是否恒定注入（忽略关键字）；与 triggerMode 同步，读盘可仅看 triggerMode */
  constant: boolean
  /** 触发方式；缺省时由 constant 推断 */
  triggerMode?: LorebookTriggerMode
  /** 同轮多条命中时的优先级，数值越大越优先 */
  priority: number
  createdAt: string
  updatedAt: string
}

/** 一本世界书（产品上的「预设」层，避免与 Prompt Preset 混名） */
export interface Lorebook {
  id: string
  name: string
  description?: string
  groups: LorebookGroup[]
  entries: LorebookEntry[]
  createdAt: string
  updatedAt: string
}

export interface LorebookIndexEntry {
  id: string
  name: string
  updatedAt: string
}

export interface LorebooksIndexDocument {
  schemaVersion: 1
  savedAt: string
  lorebooks: LorebookIndexEntry[]
}

/** GET/PUT `/api/lorebooks` 聚合文档 */
export interface LorebooksDocument {
  schemaVersion: 1
  savedAt: string
  lorebooks: Lorebook[]
}
