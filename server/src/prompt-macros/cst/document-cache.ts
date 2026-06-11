import type { CstDocument } from './nodes.js'
import { parseMacroDocument } from './parser.js'

const CST_DOCUMENT_CACHE_MAX = 256

const documentCache = new Map<string, CstDocument>()

/** 解析并缓存 CST 文档（同文本多次 walk 时复用 AST） */
export function getCachedMacroDocument(text: string): CstDocument {
  const hit = documentCache.get(text)
  if (hit) {
    documentCache.delete(text)
    documentCache.set(text, hit)
    return hit
  }
  const doc = parseMacroDocument(text)
  documentCache.set(text, doc)
  if (documentCache.size > CST_DOCUMENT_CACHE_MAX) {
    const oldest = documentCache.keys().next().value
    if (oldest !== undefined) documentCache.delete(oldest)
  }
  return doc
}

/** 测试或预设热更新时清空文档缓存 */
export function clearCstDocumentCache(): void {
  documentCache.clear()
}
