/** @import 在注入前移除；保留 background: url() 等 */
const IMPORT_RE =
  /@import(?:\s+(?:url\s*\([^)]*\)|['"][^'"]*['"])|\s+[^;]+)\s*;?/gi

type SheetRow = {
  id?: unknown
  enabled?: unknown
  css?: unknown
}

type CustomStylesHost = {
  plugins: {
    getUserSettings: () => Promise<Record<string, unknown> | null | undefined>
    onUserSettingsChanged?: (cb: () => void) => void
  }
  conversation: {
    getPluginSettings: () => Promise<Record<string, unknown> | null | undefined>
    onPluginSettingsChanged: (cb: () => void) => void
  }
  registerStyles: (css: string) => void
}

function parseObjectList(raw: unknown): SheetRow[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (x): x is SheetRow =>
        Boolean(x) && typeof x === 'object' && !Array.isArray(x),
    )
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    try {
      const parsed: unknown = JSON.parse(s)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (x): x is SheetRow =>
          Boolean(x) && typeof x === 'object' && !Array.isArray(x),
      )
    } catch {
      return []
    }
  }
  return []
}

function parseSheetOverrides(raw: unknown): Record<string, boolean> {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, boolean>
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return {}
    try {
      const parsed: unknown = JSON.parse(s)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {}
      }
      return parsed as Record<string, boolean>
    } catch {
      return {}
    }
  }
  return {}
}

export function sanitizeCss(css: unknown): string {
  if (typeof css !== 'string') return ''
  return css.replace(IMPORT_RE, '')
}

function sheetEnabled(
  sheet: SheetRow,
  overrides: Record<string, boolean>,
): boolean {
  const id = typeof sheet.id === 'string' ? sheet.id.trim() : ''
  if (!id) return false
  const globalOn = sheet.enabled !== false
  if (!Object.prototype.hasOwnProperty.call(overrides, id)) {
    return globalOn
  }
  return overrides[id] === true
}

export function resolveEffectiveStyles(
  global: Record<string, unknown> | null | undefined,
  conv: Record<string, unknown> | null | undefined,
): string {
  const globalOn = global?.enabled !== false
  const convEnabled = conv?.enabled
  const inject =
    convEnabled === true || convEnabled === false ? convEnabled : globalOn
  if (!inject) return ''

  const sheets = parseObjectList(global?.sheets)
  const overrides = parseSheetOverrides(conv?.sheetOverrides)
  const parts: string[] = []

  for (const sheet of sheets) {
    if (!sheetEnabled(sheet, overrides)) continue
    const css = typeof sheet.css === 'string' ? sheet.css : ''
    const clean = sanitizeCss(css).trim()
    if (!clean) continue
    parts.push(clean)
  }

  return parts.join('\n\n')
}

async function applyStyles(host: CustomStylesHost): Promise<void> {
  const [global, conv] = await Promise.all([
    host.plugins.getUserSettings(),
    host.conversation.getPluginSettings(),
  ])
  host.registerStyles(resolveEffectiveStyles(global, conv))
}

export function register(host: CustomStylesHost): void {
  void applyStyles(host)
  host.conversation.onPluginSettingsChanged(() => {
    void applyStyles(host)
  })
  host.plugins.onUserSettingsChanged?.(() => {
    void applyStyles(host)
  })
}
