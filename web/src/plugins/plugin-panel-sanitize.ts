import DOMPurify from 'dompurify'

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

const PANEL_BASE: Record<string, unknown> = {
  USE_PROFILES: { html: true },
  ADD_ATTR: [
    'class',
    'id',
    'style',
    'type',
    'name',
    'value',
    'for',
    'min',
    'max',
    'step',
    'checked',
    'disabled',
    'readonly',
    'placeholder',
    'tabindex',
    'role',
    'aria-label',
    'aria-busy',
    'aria-selected',
    'aria-controls',
    'title',
    'data-tk-action',
    'data-tk-field',
    'data-tk-panel',
    'open',
    'hidden',
    'viewBox',
    'xmlns',
    'd',
    'fill',
    'aria-hidden',
  ],
  ADD_TAGS: ['details', 'summary', 'dl', 'dt', 'dd', 'h4', 'p'],
}

const PANEL_INTERACTIVE: Record<string, unknown> = {
  ...PANEL_BASE,
  ADD_TAGS: [
    ...(PANEL_BASE.ADD_TAGS as string[]),
    'input',
    'button',
    'textarea',
    'label',
    'svg',
    'path',
  ],
}

/** 插件左栏 HTML（只读档：无 input） */
export function sanitizePluginPanelHtml(html: string): string {
  if (typeof window === 'undefined') return ''
  return DOMPurify.sanitize(html, PANEL_BASE)
}

/** 插件左栏 HTML（交互档：允许表单控件，仍禁 script/on*） */
export function sanitizePluginPanelHtmlInteractive(html: string): string {
  if (typeof window === 'undefined') return ''
  return DOMPurify.sanitize(html, PANEL_INTERACTIVE)
}

export function installPluginPanelSanitizeHooks(): void {
  if (typeof window === 'undefined') return
  DOMPurify.addHook('uponSanitizeElement', (node) => {
    if (!(node instanceof Element)) return
    if (node.namespaceURI !== HTML_NAMESPACE) return
    const tag = node.tagName.toLowerCase()
    if (tag === 'input') {
      const type = (node.getAttribute('type') || 'text').toLowerCase()
      const allowed = new Set([
        'text',
        'number',
        'range',
        'checkbox',
        'radio',
      ])
      if (!allowed.has(type)) {
        node.remove()
      }
    }
    if (tag === 'button') {
      const type = (node.getAttribute('type') || 'submit').toLowerCase()
      if (type !== 'button') {
        node.setAttribute('type', 'button')
      }
    }
  })
}

let hooksInstalled = false

export function ensurePluginPanelSanitizeHooks(): void {
  if (hooksInstalled || typeof window === 'undefined') return
  installPluginPanelSanitizeHooks()
  hooksInstalled = true
}
