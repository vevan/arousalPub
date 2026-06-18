import { translateApiError } from '@/utils/api-error-message'
import { getActivePinia } from 'pinia'
import { usePluginUserSettingsStore } from '@/stores/plugin-user-settings'
import { clearPluginUserSettingsInflight } from '@/utils/plugin-user-settings-loader'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const TOKEN_KEY = 'arousal-auth-token'
const REFRESH_KEY = 'arousal-auth-refresh'
const DEFAULT_USER_ID_KEY = 'arousal-default-user-id'

/** 前台续期间隔（须小于非默认 idle 15min） */
const REFRESH_INTERVAL_MS = 8 * 60 * 1000

export interface AuthUser {
  id: string
  username: string
  displayName: string
  setupComplete: boolean
  avatarUrl: string
}

interface AuthResponse {
  token: string
  refreshToken: string
  user: AuthUser
  sessionKind?: 'persisted' | 'ephemeral'
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(readToken())
  const refreshToken = ref<string | null>(readRefresh())
  const user = ref<AuthUser | null>(null)
  const setupRequired = ref(false)
  const statusLoaded = ref(false)
  const seedUserId = ref<string | null>(null)
  const adminConsoleUrl = ref<string | null>(null)
  const defaultUserId = ref<string | null>(readDefaultUserId())

  let refreshTimer: ReturnType<typeof setInterval> | null = null

  const isAuthenticated = computed(
    () => Boolean(token.value && user.value?.setupComplete),
  )

  const isDefaultUserOnDevice = computed(
    () =>
      Boolean(
        defaultUserId.value &&
          user.value &&
          defaultUserId.value === user.value.id,
      ),
  )

  const isSeedAdmin = computed(
    () =>
      Boolean(
        seedUserId.value &&
          user.value &&
          user.value.id === seedUserId.value,
      ),
  )

  function readToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  }

  function readRefresh(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY)
    } catch {
      return null
    }
  }

  function readDefaultUserId(): string | null {
    try {
      return localStorage.getItem(DEFAULT_USER_ID_KEY)
    } catch {
      return null
    }
  }

  function persistToken(t: string | null) {
    token.value = t
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  }

  function persistRefresh(t: string | null) {
    refreshToken.value = t
    try {
      if (t) localStorage.setItem(REFRESH_KEY, t)
      else localStorage.removeItem(REFRESH_KEY)
    } catch {
      /* ignore */
    }
  }

  function clearAuthStorage() {
    persistToken(null)
    persistRefresh(null)
    user.value = null
    if (getActivePinia()) {
      usePluginUserSettingsStore().clearAll()
      clearPluginUserSettingsInflight()
    }
  }

  function setDefaultUserId(id: string | null) {
    defaultUserId.value = id
    try {
      if (id) localStorage.setItem(DEFAULT_USER_ID_KEY, id)
      else localStorage.removeItem(DEFAULT_USER_ID_KEY)
    } catch {
      /* ignore */
    }
  }

  async function fetchStatus(): Promise<void> {
    const res = await fetch('/api/auth/status')
    if (!res.ok) throw new Error(`auth status ${res.status}`)
    const data = (await res.json()) as {
      setupRequired?: boolean
      seedUserId?: string
      adminConsoleUrl?: string
    }
    setupRequired.value = Boolean(data.setupRequired)
    seedUserId.value =
      typeof data.seedUserId === 'string' ? data.seedUserId : null
    adminConsoleUrl.value =
      typeof data.adminConsoleUrl === 'string' ? data.adminConsoleUrl : null
    statusLoaded.value = true
  }

  async function refreshSession(): Promise<boolean> {
    const rt = refreshToken.value
    if (!rt) return false
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    })
    if (!res.ok) {
      clearAuthStorage()
      return false
    }
    const data = (await res.json()) as AuthResponse
    applyAuthResponse(data, { syncDefaultFromSession: true })
    return true
  }

  async function fetchMe(): Promise<boolean> {
    if (!token.value) return false
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (!res.ok) {
      if (refreshToken.value) {
        return refreshSession()
      }
      clearAuthStorage()
      return false
    }
    const data = (await res.json()) as { user?: AuthUser | null }
    if (!data.user) {
      clearAuthStorage()
      return false
    }
    user.value = data.user
    return true
  }

  async function initSession(): Promise<'setup' | 'login' | 'app'> {
    await fetchStatus()
    if (setupRequired.value) return 'setup'

    if (refreshToken.value) {
      const ok = await refreshSession()
      if (ok) return 'app'
      return 'login'
    }

    if (defaultUserId.value && token.value) {
      const ok = await fetchMe()
      if (ok) return 'app'
    }

    clearAuthStorage()
    return 'login'
  }

  function applyAuthResponse(
    data: AuthResponse,
    opts?: { syncDefaultFromSession?: boolean },
  ) {
    persistToken(data.token)
    persistRefresh(data.refreshToken)
    user.value = data.user
    setupRequired.value = !data.user.setupComplete

    if (opts?.syncDefaultFromSession) {
      if (data.sessionKind === 'persisted') {
        setDefaultUserId(data.user.id)
      } else if (data.sessionKind === 'ephemeral') {
        setDefaultUserId(null)
      }
    }
  }

  async function setupAccount(body: {
    username: string
    password: string
    displayName?: string
    rememberDefault?: boolean
  }) {
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: body.username,
        password: body.password,
        displayName: body.displayName,
        rememberDefault: Boolean(body.rememberDefault),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        typeof data.error === 'string'
          ? translateApiError(data.error)
          : translateApiError('validation_failed'),
      )
    }
    applyAuthResponse(data as AuthResponse)
    if (body.rememberDefault) setDefaultUserId((data as AuthResponse).user.id)
    else setDefaultUserId(null)
  }

  async function login(body: {
    username: string
    password: string
    rememberDefault?: boolean
  }) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: body.username,
        password: body.password,
        rememberDefault: Boolean(body.rememberDefault),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        typeof data.error === 'string'
          ? translateApiError(data.error)
          : translateApiError('validation_failed'),
      )
    }
    applyAuthResponse(data as AuthResponse)
    if (body.rememberDefault) setDefaultUserId((data as AuthResponse).user.id)
    else setDefaultUserId(null)
  }

  async function register(body: {
    username: string
    password: string
    displayName?: string
    rememberDefault?: boolean
  }) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: body.username,
        password: body.password,
        displayName: body.displayName,
        rememberDefault: Boolean(body.rememberDefault),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        typeof data.error === 'string'
          ? translateApiError(data.error)
          : translateApiError('validation_failed'),
      )
    }
    applyAuthResponse(data as AuthResponse)
    if (body.rememberDefault) setDefaultUserId((data as AuthResponse).user.id)
    else setDefaultUserId(null)
  }

  async function setDeviceDefault(enabled: boolean): Promise<void> {
    if (!token.value) throw new Error('未登录')
    const res = await fetch('/api/auth/device-default', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.value}`,
      },
      body: JSON.stringify({ enabled }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        typeof data.error === 'string'
          ? translateApiError(data.error)
          : translateApiError('validation_failed'),
      )
    }
    applyAuthResponse(data as AuthResponse)
    if (enabled) setDefaultUserId((data as AuthResponse).user.id)
    else setDefaultUserId(null)
  }

  async function logout() {
    const rt = refreshToken.value
    if (rt) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        })
      } catch {
        /* ignore */
      }
    }
    stopSessionRefreshLoop()
    clearAuthStorage()
  }

  function clearDefaultUser() {
    void setDeviceDefault(false)
  }

  function startSessionRefreshLoop() {
    stopSessionRefreshLoop()
    const tick = () => {
      if (!refreshToken.value) return
      void refreshSession()
    }
    refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
  }

  function stopSessionRefreshLoop() {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && refreshToken.value) {
      void refreshSession()
    }
  }

  return {
    token,
    refreshToken,
    user,
    setupRequired,
    statusLoaded,
    seedUserId,
    adminConsoleUrl,
    defaultUserId,
    isAuthenticated,
    isDefaultUserOnDevice,
    isSeedAdmin,
    fetchStatus,
    fetchMe,
    refreshSession,
    initSession,
    setupAccount,
    login,
    register,
    logout,
    clearDefaultUser,
    setDefaultUserId,
    setDeviceDefault,
    startSessionRefreshLoop,
    stopSessionRefreshLoop,
  }
})
