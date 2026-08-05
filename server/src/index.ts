import cors from '@fastify/cors'
import { ApiErrorCodes } from './api-error-codes.js'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { closeAllLanceConnections } from './lance-connection-pool.js'
import {
  resolveClientWhitelist,
  resolveCorsOrigins,
  resolveListenHost,
  resolveServerPort,
} from './config.js'
import { isClientIpAllowed } from './client-ip.js'
import { registerStaticWeb } from './static-web.js'
import { registerHybridFtsRoutes } from './hybrid-fts-routes.js'
import { registerAdminConsole } from './admin/routes.js'
import { registerRegexRoutes } from './regex-routes.js'
import { resolveDataEncryptionKey } from './data-encryption-key.js'
import { registerMaintenanceGuard } from './maintenance-guard.js'
import { scheduleStartupBackupIfNeeded } from './data-backup.js'
import { ensureUsersRegistry } from './users-index.js'
import { bootstrapBundledPluginsAtStartup } from './plugin-system/loader.js'
import { assertValidPluginId } from './plugin-system/plugin-id.js'
import { shutdownAllPluginWorkers } from './plugin-system/plugin-worker-client.js'
import { registerAuthRoutes } from './routes/auth-routes.js'
import { registerMiscRoutes } from './routes/misc-routes.js'
import { registerChatRoutes } from './routes/chat-routes.js'
import { registerSettingsRoutes } from './routes/settings-routes.js'
import { registerPromptsRoutes } from './routes/prompts-routes.js'
import { registerLorebooksRoutes } from './routes/lorebooks-routes.js'
import { registerCharactersRoutes } from './routes/characters-routes.js'
import { registerFilesRoutes } from './routes/files-routes.js'
import { registerKnowledgeRoutes } from './routes/knowledge-routes.js'
import { registerPluginsRoutes } from './routes/plugins-routes.js'

/** 角色卡 PNG 等 multipart 可能超过默认 1MB，需与 @fastify/multipart 的 fileSize 上限一致 */
const ST_IMPORT_FILE_SIZE_LIMIT = 50 * 1024 * 1024
const app = Fastify({
  logger: true,
  bodyLimit: ST_IMPORT_FILE_SIZE_LIMIT,
})

const corsOrigins = resolveCorsOrigins()
const clientWhitelist = resolveClientWhitelist()
if (clientWhitelist.length > 0) {
  // eslint-disable-next-line no-console
  console.log(
    `[config] clientWhitelist active (${clientWhitelist.length} pattern(s))`,
  )
}
await app.register(cors, {
  origin(origin, cb) {
    if (!origin) {
      cb(null, true)
      return
    }
    if (corsOrigins.length === 0) {
      cb(null, false)
      return
    }
    if (corsOrigins.includes(origin)) {
      cb(null, true)
      return
    }
    cb(null, false)
  },
})
app.addHook('onRequest', (request, reply, done) => {
  if (!clientWhitelist.length) {
    done()
    return
  }
  if (!isClientIpAllowed(request.ip, clientWhitelist)) {
    void reply.status(403).send({ error: ApiErrorCodes.client_ip_not_allowed })
    return
  }
  done()
})
await app.register(multipart, {
  limits: { fileSize: ST_IMPORT_FILE_SIZE_LIMIT },
})

app.addHook('onClose', async () => {
  closeAllLanceConnections()
  await shutdownAllPluginWorkers()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    closeAllLanceConnections()
    void shutdownAllPluginWorkers()
  })
}
registerMaintenanceGuard(app)
await registerAuthRoutes(app)
registerRegexRoutes(app)
registerHybridFtsRoutes(app)

app.addHook('preHandler', async (request, reply) => {
  const pluginId = (request.params as { pluginId?: string }).pluginId
  if (typeof pluginId !== 'string' || !pluginId.length) return
  try {
    assertValidPluginId(pluginId)
  } catch {
    return reply.status(400).send({ error: ApiErrorCodes.invalid_plugin_id })
  }
})

await registerAdminConsole(app)
await ensureUsersRegistry()
resolveDataEncryptionKey()
await bootstrapBundledPluginsAtStartup()

registerMiscRoutes(app)
registerChatRoutes(app)
registerSettingsRoutes(app)
registerPromptsRoutes(app)
registerLorebooksRoutes(app)
registerCharactersRoutes(app)
registerFilesRoutes(app)
registerKnowledgeRoutes(app)
registerPluginsRoutes(app)

await registerStaticWeb(app)

const port = resolveServerPort()
const host = resolveListenHost()

try {
  await app.listen({ port, host })
  app.log.info(`listening on http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`)
  scheduleStartupBackupIfNeeded()
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
