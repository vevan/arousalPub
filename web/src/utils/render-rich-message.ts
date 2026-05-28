import DOMPurify from 'dompurify'
import { Marked, marked } from 'marked'
import { markedSmartypants } from 'marked-smartypants'
import { wrapCurlyQuotesInHtml } from './wrap-quote-lines.js'

/**
 * 与聊天内嵌展示匹配：允许常见排版与内联样式；脚本等仍由 DOMPurify 剔除。
 * 完整 HTML 文档会先被拆成片段再消毒，避免「整页 html」在片段模式下被清空。
 */
const PURIFY_HTML: Record<string, unknown> = {
  USE_PROFILES: { html: true },
  ADD_ATTR: [
    'target',
    'rel',
    'class',
    'id',
    'style',
    'type',
    'charset',
    'name',
    'content',
    'colspan',
    'rowspan',
    'scope',
    'role',
    'aria-label',
  ],
  /** 保留 HTML 注释（如 ASST_BLOCK 边界）；内容仍经 DOMPurify 校验 */
  ADD_TAGS: ['style', '#comment'],
}

function sanitizeChatHtml(html: string): string {
  return String(DOMPurify.sanitize(html, PURIFY_HTML))
}

/**
 * 将完整文档转为可放进气泡的片段：保留 head 内 style + body 内部 HTML。
 * 否则 DOMPurify 在默认片段模式下处理 `<html>` 整树时，常会得到几乎空的结果。
 */
function fullHtmlDocumentToEmbedFragment(raw: string): string {
  const t = raw.trim()
  if (typeof DOMParser === 'undefined') return t
  if (!/^<!DOCTYPE\s|^<html[\s>]/i.test(t)) return t
  try {
    const doc = new DOMParser().parseFromString(t, 'text/html')
    const headStyles = [...doc.head.querySelectorAll('style')]
      .map((el) => el.outerHTML)
      .join('')
    const bodyHtml = doc.body?.innerHTML ?? ''
    return headStyles + bodyHtml
  } catch {
    return t
  }
}

function prepareHtmlBeforeSanitize(html: string): string {
  const t = html.trim()
  if (!t) return t
  return fullHtmlDocumentToEmbedFragment(t)
}

function sanitizeHtmlFragment(html: string): string {
  const prepared = prepareHtmlBeforeSanitize(html)
  return sanitizeChatHtml(prepared)
}

/** 无语言围栏 / 缩进代码块：判断是否为应直接渲染的 HTML/XML 片段（避免被标成 <pre><code>） */
function looksLikeHtmlFragment(raw: string): boolean {
  let t = raw.trim()
  if (t.length < 2 || t.startsWith('```')) return false
  t = t.replace(/^(\s*<!--[\s\S]*?-->\s*)+/u, '').trim()
  return (
    /^<!DOCTYPE\s/i.test(t) ||
    /^<\?xml\s/i.test(t) ||
    /^<html[\s>]/i.test(t) ||
    /^<svg[\s>]/i.test(t) ||
    /^<[a-z][\w-]*(\s[^>]*)?>/i.test(t) ||
    /^<[a-z][\w-]*\s*\/>/i.test(t)
  )
}

function isHtmlFenceLanguage(lang: string | undefined): boolean {
  const l = (lang || '').trim().toLowerCase()
  return l === 'html' || l === 'htm' || l === 'svg' || l === 'xml'
}

/** 将自定义标签转为 html 围栏，走同一套「渲染而非代码块」逻辑 */
function preprocessCodeSampleTags(source: string): string {
  return source.replace(
    /<codeSample>([\s\S]*?)<\/codeSample>/gi,
    (_m, inner: string) => `\n\n\`\`\`html\n${inner.trim()}\n\`\`\`\n\n`,
  )
}

marked.use({
  gfm: true,
  breaks: true,
})
/** 直引号 → 弯引号等；跳过 pre/code 等（扩展内置） */
marked.use(markedSmartypants({ config: 2 }))

{
  const base = new marked.Renderer()
  const originalCode = base.code.bind(base)

  /** 仅当内容确像 HTML 且消毒后仍有实质输出时才内嵌，避免 prose 里误写的 ```html ... ```（如「不要使用 ```html」）被当成整段 HTML 清空并打乱 Markdown 结构 */
  function tryEmbeddedHtml(text: string): string | null {
    if (!looksLikeHtmlFragment(text)) return null
    const sanitized = sanitizeHtmlFragment(text)
    if (!sanitized.trim()) return null
    return `<div class="md-embedded-html">${sanitized}</div>\n`
  }

  base.code = (token) => {
    const { text, lang } = token
    if (isHtmlFenceLanguage(lang)) {
      const embedded = tryEmbeddedHtml(text)
      if (embedded) return embedded
      return originalCode(token)
    }
    if (!lang) {
      const embedded = tryEmbeddedHtml(text)
      if (embedded) return embedded
    }
    return originalCode(token)
  }
  marked.use({ renderer: base })
}

/** 思维链专用：仅 GFM Markdown → HTML，不将 ```html / 类 HTML 代码块内嵌为 DOM */
const reasoningMarked = new Marked()
reasoningMarked.use({ gfm: true, breaks: true })

if (typeof window !== 'undefined') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A' || !(node instanceof HTMLAnchorElement)) return
    const href = node.getAttribute('href')
    if (!href || href.startsWith('#')) return
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  })
}

/**
 * Markdown（marked）→ HTML；```html``` 与缩进 HTML 代码块改为内嵌渲染（DOMPurify），
 * 其余 Markdown 仍走默认渲染后再整体清理。
 */
export function renderRichMessageToHtml(source: string): string {
  const s = source ?? ''
  if (!s.trim()) return ''
  try {
    const pre = preprocessCodeSampleTags(s)
    const parsed = marked.parse(pre, { async: false })
    const html = typeof parsed === 'string' ? parsed : ''
    return sanitizeChatHtml(wrapCurlyQuotesInHtml(html))
  } catch {
    return sanitizeChatHtml(s)
  }
}

/**
 * 思维链展示：标准 Markdown 输出（围栏与缩进代码均为 &lt;pre&gt;&lt;code&gt;），
 * 不做 HTML 片段内嵌；不预处理 &lt;codeSample&gt;。
 */
export function renderReasoningMarkdownToHtml(source: string): string {
  const s = source ?? ''
  if (!s.trim()) return ''
  try {
    const parsed = reasoningMarked.parse(s, { async: false })
    const html = typeof parsed === 'string' ? parsed : ''
    return sanitizeChatHtml(html)
  } catch {
    return sanitizeChatHtml(s)
  }
}
