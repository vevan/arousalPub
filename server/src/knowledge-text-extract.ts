/**
 * 从文件库 document 抽取纯文本（DOC/46 §4）。
 * 首版：txt / md / json；PDF → document_type_unsupported。
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
  'application/json',
])

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json'])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i < 0) return ''
  return name.slice(i).toLowerCase()
}

export function isKnowledgeDocumentSupported(
  mime: string,
  filename?: string,
): boolean {
  const m = mime.trim().toLowerCase()
  if (TEXT_MIME.has(m)) return true
  if (m === 'application/octet-stream' && filename) {
    return TEXT_EXT.has(extOf(filename))
  }
  if (filename && TEXT_EXT.has(extOf(filename))) return true
  return false
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
  return text
}
