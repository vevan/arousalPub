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

/** ST World Info：角色定义前 / 后 → boundWorldBefore / boundWorldAfter */
export type LorebookEntryPosition = 'before_char' | 'after_char'

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
  /**
   * 注入顺序（同书、同插入位置内）；**越小越靠前**。
   * 列表拖拽会重写为 0…n；亦可在编辑器手填。
   */
  order: number
  /** 关键字触发（空 = 仅依赖 constant / 后续扩展） */
  keys: string[]
  /** 是否恒定注入（忽略关键字）；与 triggerMode 同步，读盘可仅看 triggerMode */
  constant: boolean
  /** 触发方式；缺省时由 constant 推断 */
  triggerMode?: LorebookTriggerMode
  /**
   * 插入位置；缺省 `after_char`。
   * before_char → boundWorldBefore；after_char → boundWorldAfter。
   */
  position?: LorebookEntryPosition
  /** 预算裁切 / 命中并列时保留优先级；**越大越优先**（与 order 语义相反） */
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
