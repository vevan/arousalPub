/** 弯引号 “…” → <span class="lines">，跳过代码块与内嵌 HTML 区 */
const CURLY_QUOTE_RE = /“([^”\n]+)”/g

const SKIP_SELECTOR =
  'pre, code, kbd, script, style, textarea, .md-embedded-html, .ASST'

export function wrapCurlyQuotesInPlainText(text: string): string {
  if (!text || !text.includes('“')) return text
  return text.replace(
    CURLY_QUOTE_RE,
    '<span class="lines">“$1”</span>',
  )
}

/**
 * 在已解析的 HTML 上仅处理文本节点，避免破坏标签与代码块内容。
 */
export function wrapCurlyQuotesInHtml(html: string): string {
  if (!html || !html.includes('“')) return html
  if (typeof DOMParser === 'undefined') {
    return wrapCurlyQuotesInPlainText(html)
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
    return wrapCurlyQuotesInPlainText(html)
  }
}
