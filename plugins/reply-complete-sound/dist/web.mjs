const PLUGIN_ID = 'reply-complete-sound'
const DEFAULT_ASSET = 'default.mp3'
const TOKEN_KEY = 'arousal-auth-token'
const PLAYED_TRACE_MAX = 64

/** 同一轮对话只播一次（persist 主路径，complete 兜底去重） */
const playedTraceIds = new Set()

function rememberPlayedTrace(traceId) {
  if (!traceId) return
  playedTraceIds.add(traceId)
  while (playedTraceIds.size > PLAYED_TRACE_MAX) {
    const first = playedTraceIds.values().next().value
    if (first === undefined) break
    playedTraceIds.delete(first)
  }
}

function hasPlayedTrace(traceId) {
  return Boolean(traceId && playedTraceIds.has(traceId))
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function mediaUrl(kind, name) {
  const base = `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/${kind}/${encodeURIComponent(name)}`
  const token = readToken()
  if (!token) return base
  return `${base}?access_token=${encodeURIComponent(token)}`
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function fetchSettings() {
  const res = await fetch(
    `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/settings`,
  )
  if (!res.ok) return null
  const data = await res.json()
  return data?.settings ?? null
}

function resolveSoundUrl(settings) {
  const source = settings?.soundSource === 'custom' ? 'custom' : 'default'
  if (source === 'custom') {
    const file =
      typeof settings?.soundFile === 'string' ? settings.soundFile.trim() : ''
    if (file) return mediaUrl('user-assets', file)
  }
  return mediaUrl('assets', DEFAULT_ASSET)
}

function playOnce(url, volume) {
  return new Promise((resolve) => {
    const audio = new Audio(url)
    audio.volume = Math.max(0, Math.min(1, Number(volume) || 1))
    audio.addEventListener('ended', () => resolve(), { once: true })
    audio.addEventListener('error', () => resolve(), { once: true })
    void audio.play().catch(() => resolve())
  })
}

async function playNotification(settings) {
  const url = resolveSoundUrl(settings)
  const volume =
    typeof settings?.volume === 'number' ? settings.volume : Number(settings?.volume ?? 1)
  let repeatCount =
    typeof settings?.repeatCount === 'number'
      ? Math.round(settings.repeatCount)
      : Number(settings?.repeatCount ?? 1)
  if (!Number.isFinite(repeatCount) || repeatCount < 1) repeatCount = 1
  if (repeatCount > 10) repeatCount = 10
  let gap =
    typeof settings?.repeatGapMs === 'number'
      ? Math.round(settings.repeatGapMs)
      : Number(settings?.repeatGapMs ?? 400)
  if (!Number.isFinite(gap) || gap < 0) gap = 0

  for (let i = 0; i < repeatCount; i++) {
    await playOnce(url, volume)
    if (i < repeatCount - 1 && gap > 0) await sleep(gap)
  }
}

async function maybePlayForTrace(event) {
  const traceId = event?.traceId
  if (hasPlayedTrace(traceId)) return
  rememberPlayedTrace(traceId)

  const settings = await fetchSettings()
  if (!settings) return
  await playNotification(settings)
}

export function register(host) {
  host.lifecycle.onAssistantReplyPersisted((event) => {
    void maybePlayForTrace(event)
  })

  host.lifecycle.onAssistantReplyComplete((event) => {
    void maybePlayForTrace(event)
  })
}
