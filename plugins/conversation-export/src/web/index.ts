/** conversation-export · 群聊导出全部 segment */

const PLUGIN_ID = 'conversation-export'
const BATCH_MAX = 50

type ExportReceive = {
  id: string
  content: string
  reasoning?: string
  durationMs?: number
  estimatedTokens?: number
  completionTokens?: number
  model?: string
}

type ExportSegment = {
  speakerCharacterId: string
  receives: ExportReceive[]
  activeReceiveIndex: number
}

type ExportTurn = {
  turnOrdinal: number
  user: string
  segments: ExportSegment[]
  activeSegmentIndex: number
}

type ExportHost = {
  session: {
    conversationWriteLocked: boolean
    loading: boolean
    regeneratingTurnOrdinal: number | null
    turns: { turnOrdinal?: number }[]
    turnAvatarUrls?: { user?: string; assistant?: string }
    userAvatarLetter?: string
    assistantAvatarLetter?: string
    conversationCharacterIds?: string[]
    conversationCharacterDisplayNames?: string[]
    assistantRoleName?: string
  }
  conversation: {
    getId(): string
    runScope(
      opts: { writeLock?: boolean; requireIdle?: boolean },
      fn: (ctx: { read: (opts: { range: { from: number; to: number } }) => Promise<unknown[]> }) => Promise<void>,
    ): Promise<void>
    getMeta(): Promise<{
      title?: string
      conversationId: string
      userDisplayName: string
      assistantDisplayName: string
      exportedAt: string
      characterIds?: string[]
    }>
  }
  render: {
    richMessageToHtml(text: string): string
    reasoningToHtml(text: string): string
  }
  regex?: {
    listRules(opts: { phases: string[] }): Promise<{ id: string; label?: string; enabled: boolean }[]>
    applyText(
      text: string,
      ruleIds: string[],
      ctx: { phase: string; field: string; turnOrdinal: number; tailOrdinal: number },
    ): Promise<string>
  }
  ui: {
    notify(title: string, body?: string, opts?: { level?: 'info' | 'success' | 'warning' | 'error'; snackbar?: boolean }): void
    progress(opts: { message: string; done: number; total: number }): void
    clearProgress(): void
  }
  t(key: string, params?: Record<string, unknown>): string
  pluginKey(key: string): string
  openFormDialog(pluginId: string, model: Record<string, unknown>): void
  registerFormDialog(
    pluginId: string,
    def: {
      titleKey: string
      bodyKey: string
      fields: unknown[]
      submitKey: string
      cancelKey: string
      canSubmit(model: Record<string, unknown>): boolean
      onSubmit(host: ExportHost, model: Record<string, unknown>): Promise<void>
    },
  ): void
  registerSlotButton(slot: string, def: unknown): void
}

const DEFAULT_CSS = `
:root {
  color-scheme: light dark;
  --export-bg: #f4f4f5;
  --export-card: #ffffff;
  --export-text: #18181b;
  --export-muted: #71717a;
  --export-border: #e4e4e7;
  --export-user: #2563eb;
  --export-assistant: #960505;
}
@media (prefers-color-scheme: dark) {
  :root {
    --export-bg: #09090b;
    --export-card: #18181b;
    --export-text: #fafafa;
    --export-muted: #a1a1aa;
    --export-border: #3f3f46;
    --export-user: #60a5fa;
    --export-assistant: #34d399;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 1.5rem;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--export-bg);
  color: var(--export-text);
  line-height: 1.55;
}
.export-doc { max-width: 48rem; margin: 0 auto; }
.export-header {
  margin-bottom: 1.5rem;
  padding: 1.25rem 1.5rem;
  background: var(--export-card);
  border: 1px solid var(--export-border);
  border-radius: 12px;
}
.export-header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.35rem;
  font-weight: 600;
}
.export-header .export-meta {
  font-size: 0.875rem;
  color: var(--export-muted);
}
.export-turn {
  margin-bottom: 1.25rem;
  padding: 1rem 1.25rem;
  background: var(--export-card);
  border: 1px solid var(--export-border);
  border-radius: 12px;
}
.export-turn-label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--export-muted);
  margin-bottom: 0.75rem;
}
.export-msg {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  max-width: 92%;
}
.export-msg img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5em;
  margin: 0.5em;
}
.export-msg:last-child { margin-bottom: 0; }
.export-msg--assistant {
  margin-right: auto;
  flex-direction: row;
}
.export-msg--user {
  margin-left: auto;
  flex-direction: row-reverse;
}
.export-avatar {
  flex: 0 0 2.25rem;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  background: var(--export-border) center/cover no-repeat;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--export-text);
  flex-shrink: 0;
}
.export-avatar--user { background-color: color-mix(in srgb, var(--export-user) 18%, var(--export-card)); }
.export-avatar--assistant { background-color: color-mix(in srgb, var(--export-assistant) 18%, var(--export-card)); }
.export-avatar.has-photo { color: transparent; }
.export-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.export-msg--user .export-col { align-items: flex-end; }
.export-msg--assistant .export-col { align-items: flex-start; }
.export-role {
  font-size: 0.8125rem;
  font-weight: 600;
}
.export-role--user { color: var(--export-user); text-align: right; }
.export-role--assistant { color: var(--export-assistant); text-align: left; }
.export-body {
  font-size: 1rem;
  word-break: break-word;
  padding: 0.65rem 0.85rem;
  border-radius: 12px;
  border: 1px solid var(--export-border);
  background: color-mix(in srgb, var(--export-border) 28%, var(--export-card));
}
.export-msg--user .export-body {
  background: color-mix(in srgb, var(--export-user) 10%, var(--export-card));
  border-color: color-mix(in srgb, var(--export-user) 22%, var(--export-border));
}
.export-msg--assistant .export-body {
  background: color-mix(in srgb, var(--export-assistant) 8%, var(--export-card));
  border-color: color-mix(in srgb, var(--export-assistant) 18%, var(--export-border));
}
.export-body p:first-child { margin-top: 0; }
.export-body p:last-child { margin-bottom: 0; }
.export-body pre {
  overflow-x: auto;
  padding: 0.75rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--export-border) 40%, transparent);
}
.export-reasoning {
  width: 100%;
  border: 1px solid var(--export-border);
  border-left: 3px solid var(--export-assistant);
  border-radius: 8px;
  background: color-mix(in srgb, var(--export-assistant) 6%, var(--export-card));
  font-size: 0.875rem;
}
.export-reasoning > summary {
  list-style: none;
  cursor: pointer;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--export-assistant);
  user-select: none;
}
.export-reasoning > summary::-webkit-details-marker { display: none; }
.export-reasoning__meta {
  margin-left: 0.35rem;
  font-weight: 400;
  color: var(--export-muted);
}
.export-reasoning__body {
  padding: 0.5rem 0.75rem 0.75rem;
  border-top: 1px solid var(--export-border);
}
.export-turn-meta {
  font-size: 0.75rem;
  color: var(--export-muted);
}
.export-msg--user .export-turn-meta { text-align: right; }
.export-embed-removed {
  margin: 0.5rem 0 0;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  color: var(--export-muted);
  background: color-mix(in srgb, var(--export-border) 35%, transparent);
  border: 1px dashed var(--export-border);
}
`.trim()

function isBusy(host: ExportHost): boolean {
  return (
    host.session.conversationWriteLocked ||
    host.session.loading ||
    host.session.regeneratingTurnOrdinal !== null
  )
}

async function fetchSettings() {
  const res = await fetch(
    `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/settings`,
  )
  if (!res.ok) return null
  const data = (await res.json()) as { settings?: Record<string, unknown> }
  return data?.settings ?? null
}

function maxTurnOrdinal(host: ExportHost): number {
  let max = -1
  for (const t of host.session.turns ?? []) {
    if (typeof t.turnOrdinal === 'number' && t.turnOrdinal > max) {
      max = t.turnOrdinal
    }
  }
  return max
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDurationMs(ms: number): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1000) return `${Math.round(n)}ms`
  const s = n / 1000
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`
}

async function urlToDataUrl(url: string | undefined): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function buildAvatarStyles(userDataUrl: string | null, assistantDataUrl: string | null): string {
  const rules: string[] = []
  if (userDataUrl) {
    rules.push(
      `.export-avatar--user.has-photo{background-image:url(${userDataUrl})}`,
    )
  }
  if (assistantDataUrl) {
    rules.push(
      `.export-avatar--assistant.has-photo{background-image:url(${assistantDataUrl})}`,
    )
  }
  return rules.join('\n')
}

function reasoningCharsCount(text: string): number {
  return String(text ?? '').replace(/\s/g, '').length
}

function renderReasoningDetails(host: ExportHost, reasoningText: string): string {
  const summary = escapeHtml(host.t('chat.reasoningSummary'))
  const meta = escapeHtml(
    host.t('chat.reasoningCharsMeta', {
      n: reasoningCharsCount(reasoningText),
    }),
  )
  return `<details name="export-reasoning" class="export-reasoning">
<summary>${summary}<span class="export-reasoning__meta">${meta}</span></summary>
<div class="export-reasoning__body">${renderReasoningForExport(host, reasoningText)}</div>
</details>`
}

function avatarClass(role: 'user' | 'assistant', hasPhoto: boolean): string {
  return `export-avatar export-avatar--${role}${hasPhoto ? ' has-photo' : ''}`
}

const EXPORT_FORBIDDEN_TAGS = [
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'base',
]

function sanitizeExportRichHtml(html: string, removedLabel: string): string {
  const s = String(html ?? '').trim()
  if (!s) return s
  if (typeof DOMParser === 'undefined') return s
  try {
    const doc = new DOMParser().parseFromString(
      `<div id="__export_root__">${s}</div>`,
      'text/html',
    )
    const root = doc.getElementById('__export_root__')
    if (!root) return s

    for (const tag of EXPORT_FORBIDDEN_TAGS) {
      root.querySelectorAll(tag).forEach((el) => {
        const repl = doc.createElement('div')
        repl.className = 'export-embed-removed'
        repl.textContent = removedLabel
        el.replaceWith(repl)
      })
    }

    root.querySelectorAll('meta[http-equiv]').forEach((el) => {
      const he = (el.getAttribute('http-equiv') || '').trim().toLowerCase()
      if (he === 'refresh') el.remove()
    })

    root.querySelectorAll('a[target], form[target]').forEach((el) => {
      const target = (el.getAttribute('target') || '').trim().toLowerCase()
      if (
        target === '_parent' ||
        target === '_top' ||
        (target && target !== '_blank' && target !== '_self')
      ) {
        el.removeAttribute('target')
      }
    })

    return root.innerHTML
  } catch {
    return s
  }
}

function renderRichForExport(host: ExportHost, text: string): string {
  const k = (key: string) => host.pluginKey(key)
  const raw = host.render.richMessageToHtml(text)
  return sanitizeExportRichHtml(raw, host.t(k('embedRemoved')))
}

function renderReasoningForExport(host: ExportHost, text: string): string {
  const k = (key: string) => host.pluginKey(key)
  const raw = host.render.reasoningToHtml(text)
  return sanitizeExportRichHtml(raw, host.t(k('embedRemoved')))
}

function buildReceiveMeta(receive: ExportReceive | undefined, includeMeta: boolean): string {
  if (!includeMeta || !receive) return ''
  const parts: string[] = []
  if (receive.model) parts.push(`model: ${escapeHtml(receive.model)}`)
  if (receive.durationMs != null) {
    const d = formatDurationMs(receive.durationMs)
    if (d) parts.push(`duration: ${d}`)
  }
  if (receive.completionTokens != null) {
    parts.push(`tokens: ${receive.completionTokens}`)
  }
  if (parts.length === 0) return ''
  return `<div class="export-turn-meta">${parts.join(' · ')}</div>`
}

function mapReceiveRow(raw: Record<string, unknown>): ExportReceive {
  const rec: ExportReceive = {
    id: typeof raw.id === 'string' ? raw.id : '',
    content: typeof raw.content === 'string' ? raw.content : '',
  }
  if (typeof raw.reasoning === 'string' && raw.reasoning.length > 0) {
    rec.reasoning = raw.reasoning
  }
  if (typeof raw.durationMs === 'number' && raw.durationMs > 0) {
    rec.durationMs = raw.durationMs
  }
  if (typeof raw.estimatedTokens === 'number' && raw.estimatedTokens > 0) {
    rec.estimatedTokens = raw.estimatedTokens
  }
  if (typeof raw.completionTokens === 'number' && raw.completionTokens > 0) {
    rec.completionTokens = raw.completionTokens
  }
  if (typeof raw.model === 'string' && raw.model.trim()) {
    rec.model = raw.model.trim()
  }
  return rec
}

function parseTurnsFromApi(raw: unknown[]): ExportTurn[] {
  const out: ExportTurn[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const turnOrdinal =
      typeof o.turnOrdinal === 'number' && Number.isFinite(o.turnOrdinal)
        ? o.turnOrdinal
        : i
    const user = typeof o.user === 'string' ? o.user : ''
    const segments: ExportSegment[] = []
    if (Array.isArray(o.segments)) {
      for (const segRaw of o.segments) {
        if (!segRaw || typeof segRaw !== 'object') continue
        const seg = segRaw as Record<string, unknown>
        const receives = Array.isArray(seg.receives)
          ? seg.receives
              .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
              .map(mapReceiveRow)
          : []
        let ai =
          typeof seg.activeReceiveIndex === 'number' &&
          Number.isFinite(seg.activeReceiveIndex)
            ? seg.activeReceiveIndex
            : 0
        if (receives.length > 0) {
          ai = Math.min(Math.max(0, ai), receives.length - 1)
        }
        segments.push({
          speakerCharacterId:
            typeof seg.speakerCharacterId === 'string' ? seg.speakerCharacterId : '',
          receives,
          activeReceiveIndex: ai,
        })
      }
    }
    const segCount = Math.max(segments.length, 1)
    let activeSegmentIndex =
      typeof o.activeSegmentIndex === 'number' &&
      Number.isFinite(o.activeSegmentIndex)
        ? o.activeSegmentIndex
        : 0
    activeSegmentIndex = Math.min(Math.max(0, activeSegmentIndex), segCount - 1)
    out.push({ turnOrdinal, user, segments, activeSegmentIndex })
  }
  return out.sort((a, b) => a.turnOrdinal - b.turnOrdinal)
}

async function fetchTurnsRangeFromApi(
  conversationId: string,
  from: number,
  to: number,
): Promise<ExportTurn[]> {
  const qs = new URLSearchParams({ from: String(from), to: String(to) })
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?${qs}`,
  )
  if (!res.ok) return []
  const j = (await res.json()) as { turns?: unknown[] }
  return parseTurnsFromApi(Array.isArray(j.turns) ? j.turns : [])
}

function activeReceiveForSegment(seg: ExportSegment): ExportReceive | undefined {
  const receives = seg.receives ?? []
  if (receives.length === 0) return undefined
  const idx = Math.min(
    Math.max(0, seg.activeReceiveIndex),
    receives.length - 1,
  )
  return receives[idx]
}

function turnUserSendEstimatedTokens(turn: ExportTurn): number | null {
  for (const seg of turn.segments) {
    const rec = activeReceiveForSegment(seg)
    const n = rec?.estimatedTokens
    if (typeof n === 'number' && n > 0) return Math.round(n)
  }
  return null
}

function buildUserSendMeta(turn: ExportTurn, includeMeta: boolean): string {
  if (!includeMeta || !turn.user?.trim()) return ''
  const tokens = turnUserSendEstimatedTokens(turn)
  if (tokens == null) return ''
  return `<div class="export-turn-meta">tokens: ${tokens}</div>`
}

function characterNameById(
  characterId: string,
  characterIds: string[],
  characterNames: string[],
): string {
  const idx = characterIds.indexOf(characterId)
  if (idx >= 0 && characterNames[idx]?.trim()) return characterNames[idx]!.trim()
  return ''
}

function assistantDisplayNameForSegment(
  host: ExportHost,
  meta: { assistantDisplayName: string; characterIds?: string[] },
  seg: ExportSegment,
): string {
  const ids =
    meta.characterIds ??
    host.session.conversationCharacterIds ??
    []
  const names = host.session.conversationCharacterDisplayNames ?? []
  const cid = seg.speakerCharacterId?.trim()
  if (cid && ids.length > 0) {
    const bound = characterNameById(cid, [...ids], [...names])
    if (bound) return bound
  }
  return (
    host.session.assistantRoleName?.trim() ||
    meta.assistantDisplayName?.trim() ||
    'Assistant'
  )
}

function assistantLetterForName(name: string, fallback: string): string {
  const m = name.trim() || fallback
  const ch = m.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '').charAt(0)
  return ch ? ch.toUpperCase() : fallback
}

function segmentsToExport(turn: ExportTurn): ExportSegment[] {
  if (turn.segments.length === 0) return []
  return turn.segments.filter((seg) => {
    const rec = activeReceiveForSegment(seg)
    return !!rec?.content?.trim()
  })
}

function ruleOptionLabel(rule: { id: string; label?: string }): string {
  const label = typeof rule.label === 'string' ? rule.label.trim() : ''
  return label || rule.id
}

async function loadExportRegexRuleOptions(host: ExportHost) {
  if (!host.regex?.listRules) return []
  try {
    const rules = await host.regex.listRules({ phases: ['display'] })
    return rules
      .filter((r) => r.enabled)
      .map((r) => ({
        value: r.id,
        label: ruleOptionLabel(r),
      }))
  } catch {
    return []
  }
}

async function applyExportRegexText(
  host: ExportHost,
  text: string,
  field: string,
  turnOrdinal: number,
  tailOrdinal: number,
  ruleIds: string[],
): Promise<string> {
  const s = String(text ?? '')
  if (!s.trim() || !Array.isArray(ruleIds) || ruleIds.length === 0) return s
  if (!host.regex?.applyText) return s
  try {
    return await host.regex.applyText(s, ruleIds, {
      phase: 'display',
      field,
      turnOrdinal,
      tailOrdinal,
    })
  } catch {
    return s
  }
}

async function renderTurnHtml(
  host: ExportHost,
  turn: ExportTurn,
  ctx: {
    meta: {
      userDisplayName: string
      assistantDisplayName: string
      characterIds?: string[]
    }
    settings: { includeReasoning: boolean; includeMeta: boolean; includeAvatars: boolean }
    hasUserPhoto: boolean
    hasAssistantPhoto: boolean
    turnLabel: (ord: number) => string
    regexRuleIds: string[]
    tailOrdinal: number
  },
): Promise<string> {
  const {
    meta,
    settings,
    hasUserPhoto,
    hasAssistantPhoto,
    turnLabel,
    regexRuleIds,
    tailOrdinal,
  } = ctx
  const userLetter = escapeHtml(host.session.userAvatarLetter ?? 'Y')
  const defaultAssistantLetter = escapeHtml(host.session.assistantAvatarLetter ?? 'N')
  const showUserPhoto = settings.includeAvatars && hasUserPhoto
  const showAssistantPhoto = settings.includeAvatars && hasAssistantPhoto

  const exportSegments = segmentsToExport(turn)

  let html = `<article class="export-turn" data-turn="${turn.turnOrdinal}">`
  html += `<div class="export-turn-label">${escapeHtml(turnLabel(turn.turnOrdinal))}</div>`

  const turnOrd = turn.turnOrdinal
  let userText = turn.user
  if (userText?.trim()) {
    userText = await applyExportRegexText(
      host,
      userText,
      'user',
      turnOrd,
      tailOrdinal,
      regexRuleIds,
    )
  }

  if (userText?.trim()) {
    html += `<div class="export-msg export-msg--user">`
    html += `<div class="${avatarClass('user', showUserPhoto)}">${showUserPhoto ? '' : userLetter}</div>`
    html += `<div class="export-col">`
    html += `<div class="export-role export-role--user">${escapeHtml(meta.userDisplayName)}</div>`
    html += `<div class="export-body">${renderRichForExport(host, userText)}</div>`
    html += buildUserSendMeta(turn, settings.includeMeta)
    html += `</div></div>`
  }

  for (let segIdx = 0; segIdx < exportSegments.length; segIdx++) {
    const seg = exportSegments[segIdx]!
    const receive = activeReceiveForSegment(seg)
    if (!receive?.content?.trim()) continue

    const roleName = assistantDisplayNameForSegment(host, meta, seg)
    const assistantLetter = assistantLetterForName(roleName, defaultAssistantLetter)

    let assistantContent = receive.content
    let assistantReasoning = receive.reasoning
    if (assistantContent?.trim()) {
      assistantContent = await applyExportRegexText(
        host,
        assistantContent,
        'assistant',
        turnOrd,
        tailOrdinal,
        regexRuleIds,
      )
    }
    if (settings.includeReasoning && assistantReasoning?.trim()) {
      assistantReasoning = await applyExportRegexText(
        host,
        assistantReasoning,
        'reasoning',
        turnOrd,
        tailOrdinal,
        regexRuleIds,
      )
    }

    html += `<div class="export-msg export-msg--assistant">`
    html += `<div class="${avatarClass('assistant', showAssistantPhoto)}">${showAssistantPhoto ? '' : assistantLetter}</div>`
    html += `<div class="export-col">`
    html += `<div class="export-role export-role--assistant">${escapeHtml(roleName)}</div>`
    if (settings.includeReasoning && assistantReasoning?.trim()) {
      html += renderReasoningDetails(host, assistantReasoning)
    }
    html += `<div class="export-body">${renderRichForExport(host, assistantContent)}</div>`
    html += buildReceiveMeta(receive, settings.includeMeta)
    html += `</div></div>`
  }

  html += `</article>`
  return html
}

function buildDocumentHtml(
  host: ExportHost,
  meta: {
    title?: string
    conversationId: string
    userDisplayName: string
    assistantDisplayName: string
    exportedAt: string
  },
  turnParts: string[],
  settings: Record<string, unknown>,
  avatarStyles: string,
): string {
  const customCss = typeof settings.customCss === 'string' ? settings.customCss : ''
  const title = escapeHtml(meta.title || meta.conversationId)
  const exportedAt = escapeHtml(
    new Date(meta.exportedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  )
  const avatarCss = avatarStyles?.trim()
    ? `\n<style>${avatarStyles}</style>`
    : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${DEFAULT_CSS}</style>
${customCss.trim() ? `<style>${customCss}</style>` : ''}${avatarCss}
</head>
<body>
<div class="export-doc">
<header class="export-header">
<h1>${title}</h1>
<div class="export-meta">${escapeHtml(meta.userDisplayName)} · ${escapeHtml(meta.assistantDisplayName)} · ${exportedAt}</div>
</header>
${turnParts.join('\n')}
</div>
</body>
</html>`
}

function safeFileName(
  title: string | undefined,
  conversationId: string,
  range: { from: number; to: number; maxOrd: number },
): string {
  const base = (title || conversationId || 'conversation')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 72)
  const rangeSuffix =
    range.from > 0 || range.to < range.maxOrd
      ? `_${range.from}-${range.to}`
      : ''
  return `${base || 'conversation'}${rangeSuffix}.html`
}

function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function resolveExportRange(model: Record<string, unknown>, maxOrd: number) {
  if (model.rangeMode !== 'partial') {
    return { from: 0, to: maxOrd, maxOrd }
  }
  const from = parseInt(String(model.fromOrdinal ?? ''), 10)
  const to = parseInt(String(model.toOrdinal ?? ''), 10)
  return { from, to, maxOrd }
}

function parsePartialRange(model: Record<string, unknown>, maxOrd: number) {
  const from = parseInt(String(model.fromOrdinal ?? ''), 10)
  const to = parseInt(String(model.toOrdinal ?? ''), 10)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  if (from < 0 || to < from || to > maxOrd) return null
  return { from, to }
}

async function exportConversation(
  host: ExportHost,
  range: { from: number; to: number; maxOrd: number },
  regexRuleIds: string[],
): Promise<void> {
  const k = (key: string) => host.pluginKey(key)
  const settings = (await fetchSettings()) ?? {}
  const includeReasoning = settings.includeReasoning === true
  const includeMeta = settings.includeMeta !== false
  const includeAvatars = settings.includeAvatars !== false
  const selectedRuleIds = Array.isArray(regexRuleIds)
    ? regexRuleIds.filter((id) => typeof id === 'string' && id.trim())
    : []
  const tailOrdinal = maxTurnOrdinal(host)

  const { from: rangeFrom, to: rangeTo, maxOrd } = range
  if (maxOrd < 0 || rangeFrom > rangeTo) {
    host.ui.notify(host.t(k('toastEmpty')), undefined, { level: 'info' })
    return
  }

  const conversationId = host.conversation.getId()
  const totalTurns = rangeTo - rangeFrom + 1
  let turnParts: string[] = []

  try {
    await host.conversation.runScope(
      { writeLock: true, requireIdle: true },
      async () => {
        const meta = await host.conversation.getMeta()
        let userAvatarData: string | null = null
        let assistantAvatarData: string | null = null
        if (includeAvatars) {
          const urls = host.session.turnAvatarUrls ?? {}
          userAvatarData = await urlToDataUrl(urls.user)
          assistantAvatarData = await urlToDataUrl(urls.assistant)
        }
        const avatarStyles = buildAvatarStyles(userAvatarData, assistantAvatarData)
        const hasUserPhoto = Boolean(userAvatarData)
        const hasAssistantPhoto = Boolean(assistantAvatarData)

        const turnLabel = (ord: number) => {
          try {
            return host.t('chat.turnLabel', { n: ord })
          } catch {
            return `#${ord}`
          }
        }

        turnParts = []
        let processed = 0

        for (let from = rangeFrom; from <= rangeTo; from += BATCH_MAX) {
          const to = Math.min(from + BATCH_MAX - 1, rangeTo)
          const batch = await fetchTurnsRangeFromApi(conversationId, from, to)
          processed = to - rangeFrom + 1
          host.ui.progress({
            message: host.t(k('progressReading')),
            done: processed,
            total: totalTurns,
          })
          for (const turn of batch) {
            turnParts.push(
              await renderTurnHtml(host, turn, {
                meta,
                settings: { includeReasoning, includeMeta, includeAvatars },
                hasUserPhoto,
                hasAssistantPhoto,
                turnLabel,
                regexRuleIds: selectedRuleIds,
                tailOrdinal,
              }),
            )
          }
        }

        host.ui.progress({
          message: host.t(k('progressBuilding')),
          done: 0,
          total: 1,
        })

        const html = buildDocumentHtml(
          host,
          meta,
          turnParts,
          settings,
          avatarStyles,
        )

        host.ui.progress({
          message: host.t(k('progressDone')),
          done: 1,
          total: 1,
        })

        downloadHtml(
          safeFileName(meta.title, meta.conversationId, {
            from: rangeFrom,
            to: rangeTo,
            maxOrd,
          }),
          html,
        )
      },
    )
    host.ui.notify(host.t(k('toastDone')), undefined, { level: 'success' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    host.ui.notify(`${host.t(k('toastFailed'))}: ${msg}`, undefined, { level: 'error' })
  } finally {
    host.ui.clearProgress()
  }
}

function exportDialogFields(k: (key: string) => string, ruleOptions: { value: string; label: string }[]) {
  const fields: Record<string, unknown>[] = [
    {
      key: 'rangeMode',
      labelKey: k('rangeModeLabel'),
      type: 'radio',
      options: [
        { value: 'all', labelKey: k('rangeAll') },
        { value: 'partial', labelKey: k('rangePartial') },
      ],
    },
    {
      key: 'fromOrdinal',
      labelKey: k('fromOrdinalLabel'),
      type: 'integer',
      visibleWhen: { field: 'rangeMode', equals: 'partial' },
    },
    {
      key: 'toOrdinal',
      labelKey: k('toOrdinalLabel'),
      type: 'integer',
      hintKey: k('ordinalHint'),
      visibleWhen: { field: 'rangeMode', equals: 'partial' },
    },
  ]
  if (ruleOptions.length > 0) {
    fields.push({
      key: 'regexRuleIds',
      labelKey: k('regexRulesLabel'),
      type: 'checkboxGroup',
      hintKey: k('regexRulesHint'),
      options: ruleOptions,
    })
  }
  return fields
}

function registerExportFormDialog(
  host: ExportHost,
  ruleOptions: { value: string; label: string }[],
): void {
  const k = (key: string) => host.pluginKey(key)
  host.registerFormDialog(PLUGIN_ID, {
    titleKey: k('dialogTitle'),
    bodyKey: k('dialogBody'),
    fields: exportDialogFields(k, ruleOptions),
    submitKey: k('confirmOk'),
    cancelKey: k('confirmCancel'),
    canSubmit(model) {
      const maxOrd = Number(model._maxOrdinal)
      if (!Number.isFinite(maxOrd) || maxOrd < 0) return false
      if (model.rangeMode !== 'partial') return true
      return parsePartialRange(model, maxOrd) != null
    },
    onSubmit: async (hostApi, model) => {
      const maxOrd = Number(model._maxOrdinal)
      const range = resolveExportRange(model, maxOrd)
      const regexRuleIds = Array.isArray(model.regexRuleIds)
        ? model.regexRuleIds.filter((id): id is string => typeof id === 'string')
        : []
      await exportConversation(hostApi, range, regexRuleIds)
    },
  })
}

export function register(host: ExportHost): void {
  const k = (key: string) => host.pluginKey(key)

  registerExportFormDialog(host, [])

  host.registerSlotButton('composer-toolbar', {
    id: `${PLUGIN_ID}-export`,
    icon: 'mdi-file-export-outline',
    tooltipKey: k('tooltip'),
    disabled: () => isBusy(host),
    onClick: async () => {
      const maxOrd = maxTurnOrdinal(host)
      if (maxOrd < 0) {
        host.ui.notify(host.t(k('toastEmpty')), undefined, { level: 'info' })
        return
      }
      const ruleOptions = await loadExportRegexRuleOptions(host)
      registerExportFormDialog(host, ruleOptions)
      host.openFormDialog(PLUGIN_ID, {
        rangeMode: 'all',
        fromOrdinal: '0',
        toOrdinal: String(maxOrd),
        _maxOrdinal: maxOrd,
        regexRuleIds: ruleOptions.map((o) => o.value),
      })
    },
  })
}
