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

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z]/i.test(ch)
}

/** 常见西文缩写（含结尾句点，小写）；点分缩写（e.g. / U.S.）由结构判定 */
const ABBREVIATIONS = new Set([
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'prof.',
  'st.',
  'jr.',
  'sr.',
  'vs.',
  'etc.',
  'no.',
  'fig.',
  'al.',
  'cf.',
  'ca.',
])

/**
 * chars[dotAt] 为 '.'：向前收集「字母/句点」词，判定缩写。
 * 单字母首字母（J.）、点分缩写（e.g. / U.S.）、常见缩写表均不视为句末。
 */
function isAbbreviationDot(
  chars: string[],
  dotAt: number,
  start: number,
): boolean {
  let i = dotAt - 1
  let letters = 0
  while (
    i >= start &&
    dotAt - i <= 12 &&
    (isAsciiLetter(chars[i]) || chars[i] === '.')
  ) {
    if (isAsciiLetter(chars[i])) letters++
    i--
  }
  if (letters === 0) return false
  const token = chars
    .slice(i + 1, dotAt + 1)
    .join('')
    .toLowerCase()
  const lettersOnly = token.replace(/\./g, '')
  if (lettersOnly.length === 1) return true
  if (token.slice(0, -1).includes('.')) return true
  return ABBREVIATIONS.has(token)
}

/**
 * 西文句号是否视为句末：跳过其后的闭合符号，须紧跟空白，且前词非缩写。
 * 闭合符只允许吞到窗口 end 内（与切点返回时的吞并范围一致），
 * 否则会认定句末却把闭合符留给下一片。
 */
function isSentenceEndingDot(
  chars: string[],
  dotAt: number,
  start: number,
  end: number,
): boolean {
  let j = dotAt + 1
  while (j < end && TRAILING_CLOSERS.has(chars[j]!)) j++
  if (!isWhitespaceChar(chars[j])) return false
  return !isAbbreviationDot(chars, dotAt, start)
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
    // 西文句号歧义大（小数、缩写）：可隔闭合符后跟空白，且排除缩写
    else if (
      lastPunct < 0 &&
      ch === '.' &&
      isSentenceEndingDot(chars, i, start, end)
    )
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
