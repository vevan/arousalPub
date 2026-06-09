import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ApiErrorCodes } from './api-error-codes.js'
import fastifyJwt from '@fastify/jwt'
import { createReadStream, existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import type { UserIndexEntry } from './users-index.js'
import { getUserAvatarPath } from './config.js'
import { runRequestUser } from './user-context.js'
import {
  assertJwtSessionValid,
  createAuthSession,
  getAuthAccessExpiresIn,
  getServerEpoch,
  initAuthSessions,
  refreshAuthSession,
  revokeAllSessionsForUser,
  revokeRefreshToken,
  revokeSessionById,
  touchSessionById,
  type SessionKind,
} from './auth-sessions.js'
import {
  authenticateUser,
  completeSeedUserSetup,
  deleteUserAccount,
  ensureUsersRegistry,
  findUserById,
  getUserStorageStats,
  publicUser,
  readUsersIndex,
  registerUser,
  updateUserPassword,
} from './users-index.js'
import { RESERVED_USER_ID } from './short-id.js'
import { UserAccountError } from './user-account-error.js'
import { resolveJwtSecret } from './auth-secret.js'
import { buildAdminConsoleUrl } from './admin/console-url.js'
import { tryAcquireAuthRateLimitSlot } from './auth-rate-limit.js'
import { isLoopbackAddress } from './client-ip.js'
import { resolveAllowPublicRegister } from './config.js'

export interface JwtPayload {
  sub: string
  username: string
  sid: string
  kind: SessionKind
  /** 非默认（ephemeral）会话：须与当前进程 serverEpoch 一致 */
  epoch?: number
}

const AUTH_PUBLIC_PATHS = new Set([
  '/health',
  '/api/backup/status',
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
])

function isPublicRoute(url: string): boolean {
  const pathOnly = url.split('?')[0] ?? url
  if (AUTH_PUBLIC_PATHS.has(pathOnly)) return true
  if (pathOnly === `/api/users/${RESERVED_USER_ID}/avatar`) return true
  return false
}

function authHeaderToken(request: FastifyRequest): string | undefined {
  const h = request.headers.authorization
  const raw = Array.isArray(h) ? h[0] : h
  if (typeof raw !== 'string') return undefined
  const m = raw.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim()
}

const IMAGE_GET_WITH_QUERY_TOKEN_RE =
  /^\/api\/characters\/[0-9a-f]{8}\/image$/i
const USER_AVATAR_GET_RE = /^\/api\/users\/[0-9a-f]{8}\/avatar$/i
const PLUGIN_ASSET_GET_RE =
  /^\/api\/plugins\/[^/]+\/(assets|user-assets)\/[^/]+$/i

function accessTokenFromQuery(request: FastifyRequest): string | undefined {
  const q = request.query as { access_token?: unknown }
  if (typeof q.access_token === 'string' && q.access_token.trim()) {
    return q.access_token.trim()
  }
  return undefined
}

function allowsQueryAccessToken(pathOnly: string, method: string): boolean {
  if (method !== 'GET') return false
  return (
    IMAGE_GET_WITH_QUERY_TOKEN_RE.test(pathOnly) ||
    USER_AVATAR_GET_RE.test(pathOnly) ||
    PLUGIN_ASSET_GET_RE.test(pathOnly)
  )
}

function resolveRequestBearerToken(request: FastifyRequest): string | undefined {
  const pathOnly = request.url.split('?')[0] ?? request.url
  const header = authHeaderToken(request)
  if (header) return header
  if (allowsQueryAccessToken(pathOnly, request.method)) {
    return accessTokenFromQuery(request)
  }
  return undefined
}

async function signAccessToken(
  reply: FastifyReply,
  user: UserIndexEntry,
  sessionId: string,
  kind: SessionKind,
): Promise<string> {
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    sid: sessionId,
    kind,
    ...(kind === 'ephemeral' ? { epoch: getServerEpoch() } : {}),
  }
  return reply.jwtSign(payload)
}

async function issueAuthPair(
  reply: FastifyReply,
  user: UserIndexEntry,
  rememberDefault: boolean,
) {
  const kind: SessionKind = rememberDefault ? 'persisted' : 'ephemeral'
  const { session, refreshToken } = createAuthSession(user.id, kind)
  const token = await signAccessToken(reply, user, session.id, kind)
  return {
    token,
    refreshToken,
    user: publicUser(user),
    sessionKind: kind,
  }
}

function verifyJwtPayload(payload: JwtPayload): boolean {
  if (!payload?.sub || !payload.sid || !payload.kind) return false
  if (
    payload.kind === 'ephemeral' &&
    payload.epoch !== getServerEpoch()
  ) {
    return false
  }
  return assertJwtSessionValid(payload)
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await initAuthSessions()

  const secret = resolveJwtSecret()

  await app.register(fastifyJwt, {
    secret,
    sign: { expiresIn: getAuthAccessExpiresIn() },
  })

  app.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = await request.jwtVerify<JwtPayload>()
        if (!verifyJwtPayload(payload)) {
          return reply.status(401).send({ error: ApiErrorCodes.auth_session_expired })
        }
        touchSessionById(payload.sid)
      } catch {
        return reply.status(401).send({ error: ApiErrorCodes.auth_session_expired })
      }
    },
  )

  app.get('/api/auth/status', async () => {
    const doc = await ensureUsersRegistry()
    const seed = doc.users.find((u) => u.id === RESERVED_USER_ID)
    const setupRequired = Boolean(seed && !seed.setupComplete)
    return {
      setupRequired,
      userCount: doc.users.filter((u) => u.setupComplete).length,
      seedUserId: RESERVED_USER_ID,
      adminConsoleUrl: buildAdminConsoleUrl(),
    }
  })

  app.post<{
    Body: {
      username?: string
      password?: string
      displayName?: string
      rememberDefault?: boolean
    }
  }>('/api/auth/setup', async (request, reply) => {
    if (!isLoopbackAddress(request.ip)) {
      return reply.status(403).send({ error: ApiErrorCodes.setup_localhost_only })
    }
    if (!tryAcquireAuthRateLimitSlot('setup', request.ip)) {
      return reply.status(429).send({ error: ApiErrorCodes.auth_rate_limited })
    }
    const { username, password, displayName, rememberDefault } =
      request.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      return reply.status(400).send({ error: ApiErrorCodes.missing_username_or_password })
    }
    try {
      const user = await completeSeedUserSetup({
        username,
        password,
        displayName,
      })
      return issueAuthPair(reply, user, Boolean(rememberDefault))
    } catch (e) {
      return reply.status(400).send({
        error: e instanceof Error ? e.message : '初始设置失败',
      })
    }
  })

  app.post<{
    Body: {
      username?: string
      password?: string
      displayName?: string
      rememberDefault?: boolean
    }
  }>('/api/auth/register', async (request, reply) => {
    if (!resolveAllowPublicRegister()) {
      return reply
        .status(403)
        .send({ error: ApiErrorCodes.public_register_disabled })
    }
    if (!tryAcquireAuthRateLimitSlot('register', request.ip)) {
      return reply.status(429).send({ error: ApiErrorCodes.auth_rate_limited })
    }
    const { username, password, displayName, rememberDefault } =
      request.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      return reply.status(400).send({ error: ApiErrorCodes.missing_username_or_password })
    }
    try {
      const user = await registerUser({ username, password, displayName })
      return issueAuthPair(reply, user, Boolean(rememberDefault))
    } catch (e) {
      return reply.status(400).send({
        error: e instanceof Error ? e.message : '注册失败',
      })
    }
  })

  app.post<{
    Body: { username?: string; password?: string; rememberDefault?: boolean }
  }>('/api/auth/login', async (request, reply) => {
    if (!tryAcquireAuthRateLimitSlot('login', request.ip)) {
      return reply.status(429).send({ error: ApiErrorCodes.auth_rate_limited })
    }
    const { username, password, rememberDefault } = request.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      return reply.status(400).send({ error: ApiErrorCodes.missing_username_or_password })
    }
    const user = await authenticateUser(username, password)
    if (!user) {
      return reply.status(401).send({ error: ApiErrorCodes.invalid_credentials })
    }
    return issueAuthPair(reply, user, Boolean(rememberDefault))
  })

  app.post<{ Body: { refreshToken?: string } }>(
    '/api/auth/refresh',
    async (request, reply) => {
      if (!tryAcquireAuthRateLimitSlot('refresh', request.ip)) {
        return reply.status(429).send({ error: ApiErrorCodes.auth_rate_limited })
      }
      const refreshToken = request.body?.refreshToken
      if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_refresh_token })
      }
      const rotated = refreshAuthSession(refreshToken.trim())
      if (!rotated) {
        return reply.status(401).send({ error: ApiErrorCodes.refresh_token_expired })
      }
      const doc = await readUsersIndex()
      const user = findUserById(doc, rotated.session.userId)
      if (!user || !user.setupComplete) {
        return reply.status(401).send({ error: ApiErrorCodes.user_not_ready })
      }
      const token = await signAccessToken(
        reply,
        user,
        rotated.session.id,
        rotated.session.kind,
      )
      return {
        token,
        refreshToken: rotated.newRefreshToken,
        user: publicUser(user),
        sessionKind: rotated.session.kind,
      }
    },
  )

  app.post<{ Body: { refreshToken?: string } }>(
    '/api/auth/logout',
    async (request) => {
      const refreshToken = request.body?.refreshToken
      if (typeof refreshToken === 'string' && refreshToken.trim()) {
        revokeRefreshToken(refreshToken.trim())
      }
      return { ok: true as const }
    },
  )

  app.post<{ Body: { enabled?: boolean } }>(
    '/api/auth/device-default',
    { preHandler: (req, rep) => app.authenticate(req, rep) },
    async (request, reply) => {
      const payload = request.user as JwtPayload
      const enabled = Boolean(request.body?.enabled)
      const doc = await readUsersIndex()
      const user = findUserById(doc, payload.sub)
      if (!user || !user.setupComplete) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_user })
      }

      revokeSessionById(payload.sid)

      if (enabled) {
        return issueAuthPair(reply, user, true)
      }

      revokeAllSessionsForUser(user.id)
      return issueAuthPair(reply, user, false)
    },
  )

  app.get(
    '/api/auth/me',
    { preHandler: (req, rep) => app.authenticate(req, rep) },
    async (request) => {
      const payload = request.user as JwtPayload
      const doc = await readUsersIndex()
      const user = findUserById(doc, payload.sub)
      if (!user || !user.setupComplete) {
        return { user: null }
      }
      return { user: publicUser(user) }
    },
  )

  app.post<{
    Body: { currentPassword?: string; newPassword?: string }
  }>(
    '/api/users/me/password',
    { preHandler: (req, rep) => app.authenticate(req, rep) },
    async (request, reply) => {
      const payload = request.user as JwtPayload
      const { currentPassword, newPassword } = request.body ?? {}
      if (
        typeof currentPassword !== 'string' ||
        typeof newPassword !== 'string'
      ) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_password_fields })
      }
      try {
        await updateUserPassword(
          payload.sub,
          currentPassword,
          newPassword,
        )
        revokeAllSessionsForUser(payload.sub)
        return { ok: true as const, requireLogin: true as const }
      } catch (e) {
        if (e instanceof UserAccountError) {
          return reply.status(400).send({ error: e.code })
        }
        return reply.status(400).send({ error: ApiErrorCodes.password_change_failed })
      }
    },
  )

  app.get(
    '/api/users/me/stats',
    { preHandler: (req, rep) => app.authenticate(req, rep) },
    async (request) => {
      const payload = request.user as JwtPayload
      return getUserStorageStats(payload.sub)
    },
  )

  app.delete<{
    Body: { confirmUsername?: string }
  }>(
    '/api/users/me',
    { preHandler: (req, rep) => app.authenticate(req, rep) },
    async (request, reply) => {
      const payload = request.user as JwtPayload
      const confirmUsername = request.body?.confirmUsername
      if (typeof confirmUsername !== 'string') {
        return reply.status(400).send({ error: ApiErrorCodes.missing_confirm_username })
      }
      try {
        await deleteUserAccount(payload.sub, confirmUsername)
        revokeAllSessionsForUser(payload.sub)
        return { ok: true as const }
      } catch (e) {
        if (e instanceof UserAccountError) {
          return reply.status(400).send({ error: e.code })
        }
        return reply.status(400).send({ error: ApiErrorCodes.delete_account_failed })
      }
    },
  )

  app.post(
    '/api/users/me/avatar',
    { preHandler: (req, rep) => app.authenticate(req, rep) },
    async (request, reply) => {
      const payload = request.user as JwtPayload
      const part = await request.file()
      if (!part) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_avatar_field })
      }
      const buf = await part.toBuffer()
      if (buf.length < 8 || buf[0] !== 0x89) {
        return reply.status(400).send({ error: ApiErrorCodes.avatar_must_be_png })
      }
      await writeFile(getUserAvatarPath(payload.sub), buf)
      return { ok: true as const }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/users/:id/avatar',
    async (request, reply) => {
      const id = request.params.id
      const avatarPath = getUserAvatarPath(id)
      if (!existsSync(avatarPath)) {
        return reply.status(404).send({ error: ApiErrorCodes.avatar_not_found })
      }
      return reply
        .type('image/png')
        .send(createReadStream(avatarPath))
    },
  )

  app.addHook('onRequest', (request, reply, done) => {
    const pathOnly = request.url.split('?')[0] ?? request.url
    if (isPublicRoute(pathOnly)) {
      done()
      return
    }

    if (!pathOnly.startsWith('/api/')) {
      done()
      return
    }

    const token = resolveRequestBearerToken(request)
    if (!token) {
      void reply.status(401).send({ error: ApiErrorCodes.auth_required })
      return
    }

    try {
      const payload = app.jwt.verify<JwtPayload>(token)
      if (!verifyJwtPayload(payload)) {
        void reply.status(401).send({ error: ApiErrorCodes.auth_session_expired })
        return
      }
      touchSessionById(payload.sid)
      runRequestUser(payload.sub, () => done())
    } catch {
      void reply.status(401).send({ error: ApiErrorCodes.auth_session_expired })
    }
  })
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>
  }
}
