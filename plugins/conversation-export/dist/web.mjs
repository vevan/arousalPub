const PLUGIN_ID = 'conversation-export'
const BATCH_MAX = 50

const DEFAULT_CSS = `
:root {
  color-scheme: light dark;
  --export-bg: #f4f4f5;
  --export-card: #ffffff;
  --export-text: #18181b;
  --export-muted: #71717a;
  --export-border: #e4e4e7;
  --export-user: #2563eb;
  --export-assistant: #059669;
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
  img {
    max-width: 100%;
  }
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
  font-size: 0.9375rem;
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

function isBusy(host) {
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
  const data = await res.json()
  return data?.settings ?? null
}

function maxTurnOrdinal(host) {
  let max = -1
  for (const t of host.session.turns ?? []) {
    if (typeof t.turnOrdinal === 'number' && t.turnOrdinal > max) {
      max = t.turnOrdinal
    }
  }
  return max
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDurationMs(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1000) return `${Math.round(n)}ms`
  const s = n / 1000
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`
}

async function urlToDataUrl(url) {
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

/** 头像 data URL 只写入文档级 CSS 一次，避免每条消息重复内联 */
function buildAvatarStyles(userDataUrl, assistantDataUrl) {
  const rules = []
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

function reasoningCharsCount(text) {
  return String(text ?? '').replace(/\s/g, '').length
}

function renderReasoningDetails(host, reasoningText) {
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

function avatarClass(role, hasPhoto) {
  return `export-avatar export-avatar--${role}${hasPhoto ? ' has-photo' : ''}`
}

/** 离线 file:// 打开时 iframe/frame 等会触发跨 origin 控制台错误，导出时剔除 */
const EXPORT_FORBIDDEN_TAGS = [
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'base',
]

function sanitizeExportRichHtml(html, removedLabel) {
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

function renderRichForExport(host, text) {
  const k = (key) => host.pluginKey(key)
  const raw = host.render.richMessageToHtml(text)
  return sanitizeExportRichHtml(raw, host.t(k('embedRemoved')))
}

function renderReasoningForExport(host, text) {
  const k = (key) => host.pluginKey(key)
  const raw = host.render.reasoningToHtml(text)
  return sanitizeExportRichHtml(raw, host.t(k('embedRemoved')))
}

function buildReceiveMeta(receive, includeMeta) {
  if (!includeMeta || !receive) return ''
  const parts = []
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

/** 与 chat-turn-display turnSendEstimatedTokens 一致 */
function turnSendEstimatedTokens(turn) {
  const len = turn.receives?.length ?? 0
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex) || 0),
    Math.max(0, len - 1),
  )
  const active = turn.receives?.[idx]
  if (typeof active?.estimatedTokens === 'number' && active.estimatedTokens > 0) {
    return Math.round(active.estimatedTokens)
  }
  for (const r of turn.receives ?? []) {
    const n = r?.estimatedTokens
    if (typeof n === 'number' && n > 0) return Math.round(n)
  }
  return null
}

function buildUserSendMeta(turn, includeMeta) {
  if (!includeMeta || !turn.user?.trim()) return ''
  const tokens = turnSendEstimatedTokens(turn)
  if (tokens == null) return ''
  return `<div class="export-turn-meta">tokens: ${tokens}</div>`
}

function renderTurnHtml(host, turn, ctx) {
  const {
    meta,
    settings,
    hasUserPhoto,
    hasAssistantPhoto,
    turnLabel,
  } = ctx
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex) || 0),
    Math.max(0, (turn.receives?.length ?? 1) - 1),
  )
  const receive = turn.receives?.[idx]
  const userLetter = escapeHtml(host.session.userAvatarLetter ?? 'Y')
  const assistantLetter = escapeHtml(host.session.assistantAvatarLetter ?? 'N')
  const showUserPhoto = settings.includeAvatars && hasUserPhoto
  const showAssistantPhoto = settings.includeAvatars && hasAssistantPhoto

  let html = `<article class="export-turn" data-turn="${turn.turnOrdinal}">`
  html += `<div class="export-turn-label">${escapeHtml(turnLabel(turn.turnOrdinal))}</div>`

  if (turn.user?.trim()) {
    html += `<div class="export-msg export-msg--user">`
    html += `<div class="${avatarClass('user', showUserPhoto)}">${showUserPhoto ? '' : userLetter}</div>`
    html += `<div class="export-col">`
    html += `<div class="export-role export-role--user">${escapeHtml(meta.userDisplayName)}</div>`
    html += `<div class="export-body">${renderRichForExport(host, turn.user)}</div>`
    html += buildUserSendMeta(turn, settings.includeMeta)
    html += `</div></div>`
  }

  if (receive?.content?.trim()) {
    html += `<div class="export-msg export-msg--assistant">`
    html += `<div class="${avatarClass('assistant', showAssistantPhoto)}">${showAssistantPhoto ? '' : assistantLetter}</div>`
    html += `<div class="export-col">`
    if (settings.includeReasoning && receive.reasoning?.trim()) {
      html += renderReasoningDetails(host, receive.reasoning)
    }
    html += `<div class="export-role export-role--assistant">${escapeHtml(meta.assistantDisplayName)}</div>`
    html += `<div class="export-body">${renderRichForExport(host, receive.content)}</div>`
    html += buildReceiveMeta(receive, settings.includeMeta)
    html += `</div></div>`
  }

  html += `</article>`
  return html
}

function buildDocumentHtml(host, meta, turnParts, settings, avatarStyles) {
  const customCss =
    typeof settings.customCss === 'string' ? settings.customCss : ''
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

function safeFileName(title, conversationId, range) {
  const base = (title || conversationId || 'conversation')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 72)
  const rangeSuffix =
    range && (range.from > 0 || range.to < range.maxOrd)
      ? `_${range.from}-${range.to}`
      : ''
  return `${base || 'conversation'}${rangeSuffix}.html`
}

function downloadHtml(filename, html) {
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

function resolveExportRange(model, maxOrd) {
  if (model.rangeMode !== 'partial') {
    return { from: 0, to: maxOrd, maxOrd }
  }
  const from = parseInt(String(model.fromOrdinal ?? ''), 10)
  const to = parseInt(String(model.toOrdinal ?? ''), 10)
  return { from, to, maxOrd }
}

function parsePartialRange(model, maxOrd) {
  const from = parseInt(String(model.fromOrdinal ?? ''), 10)
  const to = parseInt(String(model.toOrdinal ?? ''), 10)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  if (from < 0 || to < from || to > maxOrd) return null
  return { from, to }
}

async function exportConversation(host, range) {
  const k = (key) => host.pluginKey(key)
  const settings = (await fetchSettings()) ?? {}
  const includeReasoning = settings.includeReasoning === true
  const includeMeta = settings.includeMeta !== false
  const includeAvatars = settings.includeAvatars !== false

  const { from: rangeFrom, to: rangeTo, maxOrd } = range
  if (maxOrd < 0 || rangeFrom > rangeTo) {
    host.ui.toast(host.t(k('toastEmpty')))
    return
  }

  const totalTurns = rangeTo - rangeFrom + 1
  let turnParts = []

  try {
    await host.conversation.runScope(
      { writeLock: true, requireIdle: true },
      async (ctx) => {
        const meta = await host.conversation.getMeta()
        let userAvatarData = null
        let assistantAvatarData = null
        if (includeAvatars) {
          const urls = host.session.turnAvatarUrls ?? {}
          userAvatarData = await urlToDataUrl(urls.user)
          assistantAvatarData = await urlToDataUrl(urls.assistant)
        }
        const avatarStyles = buildAvatarStyles(userAvatarData, assistantAvatarData)
        const hasUserPhoto = Boolean(userAvatarData)
        const hasAssistantPhoto = Boolean(assistantAvatarData)

        const turnLabel = (ord) => {
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
          const batch = await ctx.read({ range: { from, to } })
          processed = to - rangeFrom + 1
          host.ui.progress({
            message: host.t(k('progressReading')),
            done: processed,
            total: totalTurns,
          })
          for (const turn of batch) {
            turnParts.push(
              renderTurnHtml(host, turn, {
                meta,
                settings: { includeReasoning, includeMeta, includeAvatars },
                hasUserPhoto,
                hasAssistantPhoto,
                turnLabel,
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
    host.ui.toast(host.t(k('toastDone')))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    host.ui.toast(`${host.t(k('toastFailed'))}: ${msg}`, { color: 'error' })
  } finally {
    host.ui.clearProgress()
  }
}

export function register(host) {
  const k = (key) => host.pluginKey(key)

  host.registerFormDialog(PLUGIN_ID, {
    titleKey: k('dialogTitle'),
    bodyKey: k('dialogBody'),
    fields: [
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
    ],
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
      await exportConversation(hostApi, range)
    },
  })

  host.registerSlotButton('composer-toolbar', {
    id: `${PLUGIN_ID}-export`,
    icon: 'mdi-file-export-outline',
    tooltipKey: k('tooltip'),
    disabled: () => isBusy(host),
    onClick: () => {
      const maxOrd = maxTurnOrdinal(host)
      if (maxOrd < 0) {
        host.ui.toast(host.t(k('toastEmpty')))
        return
      }
      host.openFormDialog(PLUGIN_ID, {
        rangeMode: 'all',
        fromOrdinal: '0',
        toOrdinal: String(maxOrd),
        _maxOrdinal: maxOrd,
      })
    },
  })
}
