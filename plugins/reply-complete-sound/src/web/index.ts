const PLUGIN_ID = 'reply-complete-sound'
const DEFAULT_ASSET = 'default.mp3'
const TOKEN_KEY = 'arousal-auth-token'
const PLAYED_TRACE_MAX = 64

/** 同一轮对话只播一次（persist 主路径，complete 兜底去重） */
const playedTraceIds = new Set<string>()

type ReplyLifecycleEvent = {
  traceId?: string
}

type ReplyCompleteSoundHost = {
  lifecycle: {
    onAssistantReplyPersisted: (cb: (event: ReplyLifecycleEvent) => void) => void
    onAssistantReplyComplete: (cb: (event: ReplyLifecycleEvent) => void) => void
  }
}

function rememberPlayedTrace(traceId: string | undefined): void {
  if (!traceId) return
  playedTraceIds.add(traceId)
  while (playedTraceIds.size > PLAYED_TRACE_MAX) {
    const first = playedTraceIds.values().next().value
    if (first === undefined) break
    playedTraceIds.delete(first)
  }
}

function hasPlayedTrace(traceId: string | undefined): boolean {
  return Boolean(traceId && playedTraceIds.has(traceId))
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function mediaUrl(kind: string, name: string): string {
  const base = `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/${kind}/${encodeURIComponent(name)}`
  const token = readToken()
  if (!token) return base
  return `${base}?access_token=${encodeURIComponent(token)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function fetchSettings(): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/settings`,
  )
  if (!res.ok) return null
  const data = (await res.json()) as { settings?: Record<string, unknown> }
  return data?.settings ?? null
}

function resolveSoundUrl(settings: Record<string, unknown>): string {
  const source = settings?.soundSource === 'custom' ? 'custom' : 'default'
  if (source === 'custom') {
    const file =
      typeof settings?.soundFile === 'string' ? settings.soundFile.trim() : ''
    if (file) return mediaUrl('user-assets', file)
  }
  return mediaUrl('assets', DEFAULT_ASSET)
}

function playOnce(url: string, volume: number): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(url)
    audio.volume = Math.max(0, Math.min(1, Number(volume) || 1))
    audio.addEventListener('ended', () => resolve(), { once: true })
    audio.addEventListener('error', () => resolve(), { once: true })
    void audio.play().catch(() => resolve())
  })
}

async function playNotification(
  settings: Record<string, unknown>,
): Promise<void> {
  const url = resolveSoundUrl(settings)
  const volume =
    typeof settings?.volume === 'number'
      ? settings.volume
      : Number(settings?.volume ?? 1)
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

async function maybePlayForTrace(event: ReplyLifecycleEvent): Promise<void> {
  const traceId = event?.traceId
  if (hasPlayedTrace(traceId)) return
  rememberPlayedTrace(traceId)

  const settings = await fetchSettings()
  if (!settings) return
  await playNotification(settings)
}

export function register(host: ReplyCompleteSoundHost): void {
  host.lifecycle.onAssistantReplyPersisted((event) => {
    void maybePlayForTrace(event)
  })

  host.lifecycle.onAssistantReplyComplete((event) => {
    void maybePlayForTrace(event)
  })
}
