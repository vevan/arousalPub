/**
 * §13.5 / §14.9 扫描语料：userText + memory 扫描纯文本 + history 扫描纯文本。
 * 调用方须传入已剥插件块的纯文本（见 memory-pipeline memoryScanText / recentHistoryScanText）；
 * 不再对 memory/history 做 XML 标签剥离，以免损伤正文中的 `<…>`。
 */
const DEFAULT_MAX_SCAN_CHARS = 12_000

/** 将 XML 块粗略转为纯文本（仅调试 / 兼容旧 XML 入参时使用） */
export function xmlBlockToPlainText(xml?: string | null): string {
  if (!xml?.trim()) return ''
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildScanText(
  userText: string,
  memoryScanText?: string | null,
  historyScanText?: string | null,
  maxChars = DEFAULT_MAX_SCAN_CHARS,
): string {
  const parts = [
    userText?.trim() ?? '',
    memoryScanText?.trim() ?? '',
    historyScanText?.trim() ?? '',
  ].filter((p) => p.length > 0)
  let corpus = parts.join('\n\n')
  if (corpus.length > maxChars) {
    corpus = corpus.slice(0, maxChars)
  }
  return corpus
}
