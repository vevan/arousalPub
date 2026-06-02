const PLUGIN_ID = 'reply-complete-sound'
const DEFAULT_ASSET = 'default.mp3'
const TOKEN_KEY = 'arousal-auth-token'

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

export function register(host) {
  const k = (key) => host.pluginKey(key)

  host.lifecycle.onAssistantReplyComplete(() => {
    void (async () => {
      const settings = await fetchSettings()
      if (!settings) return
      await playNotification(settings)
    })()
  })

  host.registerSlotButton('composer-toolbar', {
    id: `${PLUGIN_ID}-preview`,
    icon: 'mdi-play-circle-outline',
    tooltipKey: k('previewSound'),
    filled: false,
    onClick: () => {
      void (async () => {
        const settings = await fetchSettings()
        if (!settings) return
        await playNotification(settings)
      })()
    },
  })
}
