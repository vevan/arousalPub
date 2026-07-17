/**
 * 按字符数切片（Unicode 码点）。切点：三级边界优先，否则固定字符硬切。
 * 空行（窗口 ≥40% 处）→ 单换行（≥50%）→ 句末标点（≥60%）→ 硬切。
 * 边界查找全程在码点数组上进行，避免 UTF-16 索引与码点索引混用导致
 * 增补平面字符（emoji 等）下切点漂移、chunk 超出 chunkSizeChars。
 */

const SENTENCE_ENDERS = new Set(['。', '！', '？', '!', '?', '…', '；', ';'])

/** 句末标点后紧跟的闭合符号（引号/括号），并入当前片 */
const TRAILING_CLOSERS = new Set([
  '」',
  '』',
  '"',
  "'",
  '\u2019', // ’
  '\u201D', // ”
  '）',
  ')',
  '】',
  ']',
  '》',
  '〉',
])

function isWhitespaceChar(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch)
}

/**
 * 在 chars[start, end) 窗口内选切点，返回绝对 end 下标；无合适切点返回 -1。
 */
function findChunkBreak(
  chars: string[],
  start: number,
  end: number,
  size: number,
): number {
  const paraMin = start + Math.floor(size * 0.4)
  const nlMin = start + Math.floor(size * 0.5)
  const punctMin = start + Math.floor(size * 0.6)

  let lastNewline = -1
  let lastPunct = -1
  for (let i = end - 1; i >= start; i--) {
    const ch = chars[i]
    if (ch === '\n') {
      if (i - 1 >= paraMin && chars[i - 1] === '\n') return i + 1
      if (lastNewline < 0) lastNewline = i
      continue
    }
    if (lastPunct < 0 && SENTENCE_ENDERS.has(ch)) lastPunct = i
    // 西文句号歧义大（小数、缩写），仅在后跟空白时视为句末
    else if (lastPunct < 0 && ch === '.' && isWhitespaceChar(chars[i + 1]))
      lastPunct = i
  }
  if (lastNewline >= nlMin) return lastNewline + 1
  if (lastPunct >= punctMin) {
    let j = lastPunct + 1
    while (j < end && TRAILING_CLOSERS.has(chars[j])) j++
    return j
  }
  return -1
}

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
      const breakAt = findChunkBreak(chars, start, end, size)
      if (breakAt > start) end = breakAt
    }
    const piece = chars.slice(start, end).join('').trim()
    if (piece) chunks.push(piece)
    if (end >= chars.length) break
    const next = end - overlap
    start = next <= start ? end : next
  }
  return chunks
}
