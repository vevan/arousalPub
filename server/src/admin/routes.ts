import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiErrorCodes } from '../api-error-codes.js'
import { revokeAllSessionsForUser } from '../auth-sessions.js'
import { DATA_DIR } from '../config.js'
import {
  generateDataEncryptionKeyMaterial,
  getDataEncryptionKeySource,
  isDataEncryptionKeyConfigured,
} from '../data-encryption-key.js'
import {
  getRotateDataKeyStatus,
  startRotateDataKeyJob,
} from './rotate-data-key.js'
import { RESERVED_USER_ID } from '../short-id.js'
import { getCurrentUserId } from '../user-context.js'
import {
  UserAccountError,
  UserAccountErrorCodes,
} from '../user-account-error.js'
import {
  adminResetUserPassword,
  deleteUserByAdmin,
  findUserById,
  getUserStorageStats,
  publicUser,
  readUsersIndex,
  registerUser,
} from '../users-index.js'
import { buildAdminConsoleUrl } from './console-url.js'
import { isLoopbackAddress } from './localhost.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let cachedAdminHtml: string | null = null

function readAdminPageHtml(): string {
  if (cachedAdminHtml) return cachedAdminHtml
  cachedAdminHtml = readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  return cachedAdminHtml
}

function denyUnlessLoopback(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (!isLoopbackAddress(request.ip)) {
    void reply.status(403).send({ error: ApiErrorCodes.admin_localhost_only })
    return false
  }
  return true
}

const requireAdminConsole: preHandlerHookHandler = async (request, reply) => {
  if (!denyUnlessLoopback(request, reply)) return
  const userId = getCurrentUserId()
  if (userId !== RESERVED_USER_ID) {
    return reply
      .status(403)
      .send({ error: ApiErrorCodes.admin_seed_user_required })
  }
  const doc = await readUsersIndex()
  const user = findUserById(doc, userId)
  if (!user?.setupComplete) {
    return reply
      .status(403)
      .send({ error: ApiErrorCodes.admin_seed_user_required })
  }
}

function mapUserAccountError(e: unknown, reply: FastifyReply) {
  if (e instanceof UserAccountError) {
    if (e.code === UserAccountErrorCodes.CANNOT_DELETE_SEED_ONLY) {
      return reply
        .status(403)
        .send({ error: ApiErrorCodes.admin_cannot_delete_seed })
    }
    return reply.status(400).send({ error: e.code })
  }
  const msg = e instanceof Error ? e.message : '操作失败'
  return reply.status(400).send({ error: msg })
}

export async function registerAdminConsole(app: FastifyInstance): Promise<void> {
  app.get('/admin', async (request, reply) => {
    if (!denyUnlessLoopback(request, reply)) return
    return reply.type('text/html; charset=utf-8').send(readAdminPageHtml())
  })

  app.get(
    '/api/admin/status',
    { preHandler: requireAdminConsole },
    async () => {
      return {
        ok: true as const,
        loopback: true,
        isAdmin: true,
        dataDir: DATA_DIR,
        adminConsoleUrl: buildAdminConsoleUrl(),
        dekConfigured: isDataEncryptionKeyConfigured(),
        dekSource: getDataEncryptionKeySource(),
        rotateStatus: getRotateDataKeyStatus(),
        seedUserId: RESERVED_USER_ID,
      }
    },
  )

  app.get(
    '/api/admin/crypto/rotate-data-key/status',
    { preHandler: requireAdminConsole },
    async () => getRotateDataKeyStatus(),
  )

  app.get(
    '/api/admin/crypto/suggest-key',
    { preHandler: requireAdminConsole },
    async () => ({
      keyMaterial: generateDataEncryptionKeyMaterial(),
    }),
  )

  app.post<{
    Body: { newKeyMaterial?: string; confirm?: boolean }
  }>(
    '/api/admin/crypto/rotate-data-key',
    { preHandler: requireAdminConsole },
    async (request, reply) => {
      const { newKeyMaterial, confirm } = request.body ?? {}
      if (confirm !== true) {
        return reply.status(400).send({ error: 'confirm_required' })
      }
      if (typeof newKeyMaterial !== 'string' || !newKeyMaterial.trim()) {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.admin_rotate_invalid_key })
      }
      const result = startRotateDataKeyJob(newKeyMaterial)
      if ('error' in result) {
        const code =
          result.error === 'admin_rotate_in_progress'
            ? ApiErrorCodes.admin_rotate_in_progress
            : result.error === 'admin_rotate_invalid_key'
              ? ApiErrorCodes.admin_rotate_invalid_key
              : result.error === 'admin_rotate_same_key'
                ? ApiErrorCodes.admin_rotate_same_key
                : result.error
        return reply.status(409).send({ error: code })
      }
      return { started: true as const, status: getRotateDataKeyStatus() }
    },
  )

  app.get(
    '/api/admin/users',
    { preHandler: requireAdminConsole },
    async () => {
      const doc = await readUsersIndex()
      return {
        users: doc.users.map((u) => ({
          ...publicUser(u),
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/admin/users/:id/stats',
    { preHandler: requireAdminConsole },
    async (request, reply) => {
      const id = request.params.id.trim()
      try {
        return await getUserStorageStats(id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'stats_failed'
        return reply.status(400).send({ error: msg })
      }
    },
  )

  app.post<{
    Body: { username?: string; password?: string; displayName?: string }
  }>(
    '/api/admin/users',
    { preHandler: requireAdminConsole },
    async (request, reply) => {
      const { username, password, displayName } = request.body ?? {}
      if (typeof username !== 'string' || typeof password !== 'string') {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.missing_username_or_password })
      }
      try {
        const user = await registerUser({ username, password, displayName })
        return { user: publicUser(user) }
      } catch (e) {
        return mapUserAccountError(e, reply)
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { preHandler: requireAdminConsole },
    async (request, reply) => {
      const id = request.params.id.trim()
      try {
        await deleteUserByAdmin(id)
        revokeAllSessionsForUser(id)
        return { ok: true as const }
      } catch (e) {
        return mapUserAccountError(e, reply)
      }
    },
  )

  app.post<{
    Params: { id: string }
    Body: { password?: string; revokeSessions?: boolean }
  }>(
    '/api/admin/users/:id/password',
    { preHandler: requireAdminConsole },
    async (request, reply) => {
      const id = request.params.id.trim()
      const password =
        typeof request.body?.password === 'string'
          ? request.body.password
          : ''
      try {
        await adminResetUserPassword(id, password)
        if (request.body?.revokeSessions !== false) {
          revokeAllSessionsForUser(id)
        }
        return { ok: true as const }
      } catch (e) {
        return mapUserAccountError(e, reply)
      }
    },
  )
}
