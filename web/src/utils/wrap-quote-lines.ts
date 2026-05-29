/**
 * 对话引号 → <span class="lines">（仅处理纯文本；跳过代码块与已有 .lines）
 * 支持 “…” (U+201C/201D)、"…" (ASCII)、以及 smartypants 输出的 &#8220; 等（经 DOM 解析后为 Unicode）。
 */
const OPEN_QUOTE = '[\u201C\u0022\u2018]' // “ " ‘
const CLOSE_QUOTE = '[\u201D\u0022\u2019]' // ” " ’
const DIALOGUE_QUOTE_RE = new RegExp(
  `(?<!=)(${OPEN_QUOTE})((?:(?!${CLOSE_QUOTE})[^\\n])+?)(${CLOSE_QUOTE})`,
  'g',
)

const SKIP_SELECTOR =
  'pre, code, kbd, script, style, textarea, .md-embedded-html, .ASST, .lines'

/** marked-smartypants 常输出实体而非 Unicode 字符 */
const HTML_QUOTE_ENTITY_RE =
  /&#8220;|&#8221;|&#8216;|&#8217;|&quot;|&#x201[cd];|&#x201[89];/i

function resetDialogueQuoteRe(): void {
  DIALOGUE_QUOTE_RE.lastIndex = 0
}

function hasDialogueQuotes(text: string): boolean {
  resetDialogueQuoteRe()
  return DIALOGUE_QUOTE_RE.test(text)
}

export function wrapCurlyQuotesInPlainText(text: string): string {
  if (!text || text.includes('<')) return text
  resetDialogueQuoteRe()
  if (!hasDialogueQuotes(text)) return text
  resetDialogueQuoteRe()
  return text.replace(
    DIALOGUE_QUOTE_RE,
    (_m, open: string, inner: string, close: string) =>
      `<span class="lines">${open}${inner}${close}</span>`,
  )
}

function htmlMightNeedQuoteWrap(html: string): boolean {
  if (/[\u201C\u201D\u0022\u2018\u2019]/.test(html)) return true
  if (/(?<!=)["\u201C\u2018]/.test(html)) return true
  if (HTML_QUOTE_ENTITY_RE.test(html)) return true
  return false
}

/**
 * 在已解析的 HTML 上仅处理文本节点，避免破坏标签与代码块内容。
 */
export function wrapCurlyQuotesInHtml(html: string): string {
  if (!html || !htmlMightNeedQuoteWrap(html)) return html
  if (typeof DOMParser === 'undefined') {
    return html
  }
  try {
    const doc = new DOMParser().parseFromString(
      `<div data-quote-wrap-root="">${html}</div>`,
      'text/html',
    )
    const root = doc.querySelector('[data-quote-wrap-root]')
    if (!root) return html

    const walk = (node: Node): void => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        if (el.matches(SKIP_SELECTOR) || el.closest(SKIP_SELECTOR)) return
        for (const child of [...el.childNodes]) walk(child)
        return
      }
      if (node.nodeType !== Node.TEXT_NODE) return
      const parent = node.parentElement
      if (!parent || parent.closest(SKIP_SELECTOR)) return
      const raw = node.textContent ?? ''
      const wrapped = wrapCurlyQuotesInPlainText(raw)
      if (wrapped === raw) return
      const tpl = doc.createElement('template')
      tpl.innerHTML = wrapped
      parent.replaceChild(tpl.content, node)
    }

    for (const child of [...root.childNodes]) walk(child)
    return root.innerHTML
  } catch {
    return html
  }
}
