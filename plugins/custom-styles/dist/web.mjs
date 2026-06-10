const PLUGIN_ID = 'custom-styles'

/** @import 在注入前移除；保留 background: url() 等 */
const IMPORT_RE =
  /@import(?:\s+(?:url\s*\([^)]*\)|['"][^'"]*['"])|\s+[^;]+)\s*;?/gi

function parseObjectList(raw) {
  if (Array.isArray(raw)) {
    return raw.filter(
      (x) => x && typeof x === 'object' && !Array.isArray(x),
    )
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    try {
      const parsed = JSON.parse(s)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (x) => x && typeof x === 'object' && !Array.isArray(x),
      )
    } catch {
      return []
    }
  }
  return []
}

function parseSheetOverrides(raw) {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return /** @type {Record<string, boolean>} */ (raw)
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return {}
    try {
      const parsed = JSON.parse(s)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {}
      }
      return /** @type {Record<string, boolean>} */ (parsed)
    } catch {
      return {}
    }
  }
  return {}
}

export function sanitizeCss(css) {
  if (typeof css !== 'string') return ''
  return css.replace(IMPORT_RE, '')
}

function sheetEnabled(sheet, overrides) {
  const id = typeof sheet.id === 'string' ? sheet.id.trim() : ''
  if (!id) return false
  const globalOn = sheet.enabled !== false
  if (!Object.prototype.hasOwnProperty.call(overrides, id)) {
    return globalOn
  }
  return overrides[id] === true
}

export function resolveEffectiveStyles(global, conv) {
  const globalOn = global?.enabled !== false
  const convEnabled = conv?.enabled
  const inject =
    convEnabled === true || convEnabled === false ? convEnabled : globalOn
  if (!inject) return ''

  const sheets = parseObjectList(global?.sheets)
  const overrides = parseSheetOverrides(conv?.sheetOverrides)
  const parts = []

  for (const sheet of sheets) {
    if (!sheetEnabled(sheet, overrides)) continue
    const css = typeof sheet.css === 'string' ? sheet.css : ''
    const clean = sanitizeCss(css).trim()
    if (!clean) continue
    parts.push(clean)
  }

  return parts.join('\n\n')
}

async function applyStyles(host) {
  const [global, conv] = await Promise.all([
    host.plugins.getUserSettings(),
    host.conversation.getPluginSettings(),
  ])
  host.registerStyles(resolveEffectiveStyles(global, conv))
}

export function register(host) {
  void applyStyles(host)
  host.conversation.onPluginSettingsChanged(() => {
    void applyStyles(host)
  })
  host.plugins.onUserSettingsChanged?.(() => {
    void applyStyles(host)
  })
}
