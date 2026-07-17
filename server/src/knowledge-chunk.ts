/**
 * 按字符数切片（Unicode 码点）；优先在空行/换行处切。
 */

export function sliceKnowledgeText(
  text: string,
  opts: { chunkSizeChars: number; chunkOverlapChars: number },
): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!raw) return []

  const size = Math.max(1, opts.chunkSizeChars)
  const overlap = Math.max(0, Math.min(opts.chunkOverlapChars, size - 1))

  const chars = Array.from(raw)
  if (chars.length <= size) return [raw]

  const chunks: string[] = []
  let start = 0
  while (start < chars.length) {
    let end = Math.min(start + size, chars.length)
    if (end < chars.length) {
      const window = chars.slice(start, end)
      const joined = window.join('')
      const para = joined.lastIndexOf('\n\n')
      const nl = joined.lastIndexOf('\n')
      let breakAt = -1
      if (para >= Math.floor(size * 0.4)) breakAt = para + 2
      else if (nl >= Math.floor(size * 0.5)) breakAt = nl + 1
      if (breakAt > 0) end = start + breakAt
    }
    const piece = chars.slice(start, end).join('').trim()
    if (piece) chunks.push(piece)
    if (end >= chars.length) break
    const next = end - overlap
    start = next <= start ? end : next
  }
  return chunks
}
