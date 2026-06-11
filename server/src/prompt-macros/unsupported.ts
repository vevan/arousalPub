import {
  isKnownMacroToken,
  renderFailMacroPlaceholder,
  unsupportedMacroPlaceholder,
} from './macro-values.js'

/** 已知宏由 Handlebars 展开；其余 `{{…}}` → `[name UNSUPPORTED]` */
export function replaceUnsupportedMacroPlaceholders(text: string): string {
  if (!text.includes('{{')) return text
  let out = text.replace(/\{\{([^}]+)\}\}/g, (match, inner: string) => {
    if (isKnownMacroToken(inner)) return match
    return unsupportedMacroPlaceholder(inner)
  })
  out = out.replace(/\{\{[^}]*$/g, '[UNSUPPORTED]')
  return out
}

/** Handlebars 编译/执行失败时，将剩余 `{{…}}` 标为 `[name RENDERFAIL]` */
export function replaceRenderFailMacroPlaceholders(text: string): string {
  if (!text.includes('{{')) return text
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, inner: string) =>
    renderFailMacroPlaceholder(inner),
  )
}
