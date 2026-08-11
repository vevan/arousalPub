import type { FastifyInstance } from 'fastify'
import { readBuildInfoDocument } from '../build-meta.js'
import { getBackupStatus } from '../data-backup.js'

export function registerMiscRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({ ok: true as const }))

  app.get('/api/backup/status', async () => getBackupStatus())

  app.get('/api/build-info', async () => readBuildInfoDocument())
}
