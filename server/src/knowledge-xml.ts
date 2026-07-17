/** 知识库召回注入 XML（DOC/46 §5） */

export interface KnowledgeXmlChunk {
  kbName: string
  fileName: string
  ordinal: number
  text: string
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 文档展示名：别名优先，否则文件名去扩展名 */
export function knowledgeDocumentDisplayName(
  rawName: string,
  alias?: string | null,
): string {
  const a = alias?.trim()
  if (a) return a
  const base = rawName.trim()
  const stripped = base.replace(/\.[^./\\]+$/, '').trim()
  return stripped || base
}

export function formatKnowledgeXml(chunks: KnowledgeXmlChunk[]): string {
  if (chunks.length === 0) return ''
  const lines = ['<knowledge>']
  for (const c of chunks) {
    lines.push(
      `  <chunk collection="${escapeXml(c.kbName)}" book="${escapeXml(c.fileName)}" chapter="${c.ordinal}">`,
    )
    lines.push(escapeXml(c.text))
    lines.push('  </chunk>')
  }
  lines.push('</knowledge>')
  return lines.join('\n')
}
