/**
 * 从文件库 document 抽取纯文本（DOC/46 §4）。
 * 首版：txt / md / json；PDF → document_type_unsupported。
 * Markdown：索引前剥离闭合完整的 YAML/TOML front matter；原文落盘不变。
 */

export class KnowledgeTextExtractError extends Error {
  constructor(
    public readonly code:
      | 'document_type_unsupported'
      | 'document_empty'
      | 'document_read_failed',
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'KnowledgeTextExtractError'
  }
}

const TEXT_MIME = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/json',
])

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json'])

const MARKDOWN_MIME = new Set(['text/markdown', 'text/x-markdown'])
const MARKDOWN_EXT = new Set(['.md', '.markdown'])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i < 0) return ''
  return name.slice(i).toLowerCase()
}

export function isKnowledgeDocumentSupported(
  mime: string,
  filename?: string,
): boolean {
  const m = mime.trim().toLowerCase().split(';')[0]?.trim() ?? ''
  if (TEXT_MIME.has(m)) return true
  if (m === 'application/octet-stream' && filename) {
    return TEXT_EXT.has(extOf(filename))
  }
  if (filename && TEXT_EXT.has(extOf(filename))) return true
  return false
}

function isMarkdownDocument(mime: string, filename?: string): boolean {
  const m = mime.trim().toLowerCase().split(';')[0]?.trim() ?? ''
  if (MARKDOWN_MIME.has(m)) return true
  if (filename && MARKDOWN_EXT.has(extOf(filename))) return true
  return false
}

/** YAML `key:` / TOML `key =` 形态；front matter 块须至少含一行才剥 */
const FRONT_MATTER_KV_RE = /^\s*[\w."'-]+\s*[:=]/

/** front matter 结束分隔符只在文件开头这些行内找；再远视为正文水平线 */
const FRONT_MATTER_MAX_LINES = 100

/**
 * 剥离文件开头闭合完整的 YAML (`---`) / TOML (`+++`) front matter。
 * 保守约束（不满足则原样返回）：结束分隔符须在前 100 行内；
 * 块内至少含一行 `key:` / `key=`，避免把「以水平线开头的正文」
 * （`---` 空行 段落 `---`）误当 front matter 剥掉。
 */
export function stripMarkdownFrontMatter(text: string): string {
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return text
  const open = lines[0]!.trim()
  if (open !== '---' && open !== '+++') return text
  let sawKv = false
  const scanEnd = Math.min(lines.length, FRONT_MATTER_MAX_LINES)
  for (let i = 1; i < scanEnd; i++) {
    if (lines[i]!.trim() === open) {
      if (!sawKv) return text
      return lines.slice(i + 1).join(nl)
    }
    if (FRONT_MATTER_KV_RE.test(lines[i]!)) sawKv = true
  }
  return text
}

export function extractKnowledgeText(params: {
  buffer: Buffer
  mime: string
  filename?: string
}): string {
  if (!isKnowledgeDocumentSupported(params.mime, params.filename)) {
    throw new KnowledgeTextExtractError('document_type_unsupported')
  }
  let text: string
  try {
    text = params.buffer.toString('utf8')
  } catch {
    throw new KnowledgeTextExtractError('document_read_failed')
  }
  // strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (isMarkdownDocument(params.mime, params.filename)) {
    text = stripMarkdownFrontMatter(text)
  }
  return text
}
