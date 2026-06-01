import type { Lorebook } from '@/stores/lorebooks'

const LOREBOOK_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export interface LorebookExportDocument {
  schemaVersion: 1
  exportedAt: string
  lorebook: Lorebook
}

function validateLorebookShape(lb: Lorebook): void {
  if (!lb || typeof lb !== 'object') throw new Error('资料库格式无效')
  if (typeof lb.id !== 'string' || !LOREBOOK_ID_RE.test(lb.id)) {
    throw new Error('资料库缺少合法 id')
  }
  if (typeof lb.name !== 'string' || !lb.name.trim()) {
    throw new Error(`资料库 ${lb.id} 缺少 name`)
  }
  if (!Array.isArray(lb.groups)) throw new Error(`资料库 ${lb.id} 缺少 groups`)
  if (!Array.isArray(lb.entries)) throw new Error(`资料库 ${lb.id} 缺少 entries`)

  const groupIds = new Set<string>()
  for (const g of lb.groups) {
    if (!g || typeof g !== 'object') throw new Error('分组格式无效')
    if (typeof g.id !== 'string' || !g.id.trim()) throw new Error('分组缺少 id')
    if (groupIds.has(g.id)) throw new Error(`分组 id 重复: ${g.id}`)
    groupIds.add(g.id)
    if (typeof g.name !== 'string') throw new Error(`分组 ${g.id} 缺少 name`)
    if (typeof g.order !== 'number' || !Number.isFinite(g.order)) {
      throw new Error(`分组 ${g.id} order 无效`)
    }
  }

  const entryIds = new Set<string>()
  for (const e of lb.entries) {
    if (!e || typeof e !== 'object') throw new Error('条目格式无效')
    if (typeof e.id !== 'string' || !e.id.trim()) throw new Error('条目缺少 id')
    if (entryIds.has(e.id)) throw new Error(`条目 id 重复: ${e.id}`)
    entryIds.add(e.id)
    if (typeof e.groupId !== 'string' || !groupIds.has(e.groupId)) {
      throw new Error(`条目 ${e.id} 的 groupId 无效`)
    }
    if (typeof e.title !== 'string') throw new Error(`条目 ${e.id} 缺少 title`)
    if (typeof e.content !== 'string') throw new Error(`条目 ${e.id} 缺少 content`)
    if (typeof e.enabled !== 'boolean') throw new Error(`条目 ${e.id} enabled 无效`)
    if (typeof e.order !== 'number' || !Number.isFinite(e.order)) {
      throw new Error(`条目 ${e.id} order 无效`)
    }
    if (!Array.isArray(e.keys)) throw new Error(`条目 ${e.id} keys 须为数组`)
    if (typeof e.constant !== 'boolean') throw new Error(`条目 ${e.id} constant 无效`)
    if (
      e.triggerMode !== undefined &&
      e.triggerMode !== 'keyword' &&
      e.triggerMode !== 'constant' &&
      e.triggerMode !== 'vector'
    ) {
      throw new Error(`条目 ${e.id} triggerMode 无效`)
    }
    if (typeof e.priority !== 'number' || !Number.isFinite(e.priority)) {
      throw new Error(`条目 ${e.id} priority 无效`)
    }
  }
}

function isLorebookShape(x: unknown): x is Lorebook {
  try {
    validateLorebookShape(x as Lorebook)
    return true
  } catch {
    return false
  }
}

/**
 * 解析单本资料库导入 JSON。
 * 支持 `{ lorebook }`、仅含一本的 `{ lorebooks: […] }`，或根对象为资料库。
 */
export function parseLorebookImport(raw: unknown): Lorebook {
  if (!raw || typeof raw !== 'object') {
    throw new Error('文件须为 JSON 对象')
  }
  if (isLorebookShape(raw)) return raw

  const o = raw as { lorebook?: unknown; lorebooks?: unknown }
  if (o.lorebook !== undefined) {
    if (!isLorebookShape(o.lorebook)) throw new Error('资料库格式无效')
    return o.lorebook
  }
  if (Array.isArray(o.lorebooks)) {
    if (o.lorebooks.length !== 1) {
      throw new Error('lorebooks 数组须恰好包含一本资料库')
    }
    const lb = o.lorebooks[0]
    if (!isLorebookShape(lb)) throw new Error('资料库格式无效')
    return lb
  }
  throw new Error('未找到资料库（须含 lorebook 字段或单元素 lorebooks）')
}

export function buildLorebookExportDocument(lorebook: Lorebook): LorebookExportDocument {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    lorebook,
  }
}

export function lorebookExportFilename(name: string): string {
  const safe =
    (name || 'lorebook').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'lorebook'
  return `${safe}.lorebook.json`
}

export function downloadLorebookExport(doc: LorebookExportDocument): void {
  const json = JSON.stringify(doc, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = lorebookExportFilename(doc.lorebook.name)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
