const DEFAULT_MAX_SCAN_CHARS = 12_000

/** 将 XML 块粗略转为纯文本供关键字扫描 */
export function xmlBlockToPlainText(xml?: string | null): string {
  if (!xml?.trim()) return ''
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * §13.5 / §14.9：资料库匹配语料 = userText + memory + history（可裁剪）。
 */
export function buildScanText(
  userText: string,
  memoryText?: string | null,
  /** 近期 history 纯文本（或旧版 XML，经 xmlBlockToPlainText 剥标签） */
  historyText?: string | null,
  maxChars = DEFAULT_MAX_SCAN_CHARS,
): string {
  const parts = [
    userText?.trim() ?? '',
    xmlBlockToPlainText(memoryText),
    xmlBlockToPlainText(historyText),
  ].filter((p) => p.length > 0)
  let corpus = parts.join('\n\n')
  if (corpus.length > maxChars) {
    corpus = corpus.slice(0, maxChars)
  }
  return corpus
}
