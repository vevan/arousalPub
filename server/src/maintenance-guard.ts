import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from './api-error-codes.js'
import {
  getMaintenanceLockReason,
  shouldBlockWriteForMaintenance,
} from './maintenance-lock.js'

/** 全局维护写锁：拒绝 /api/* 写操作（admin/auth 除外） */
export function registerMaintenanceGuard(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    if (
      shouldBlockWriteForMaintenance(request.method, request.url)
    ) {
      const reason = getMaintenanceLockReason()
      const error =
        reason === 'data_backup'
          ? ApiErrorCodes.backup_in_progress
          : ApiErrorCodes.maintenance_mode
      void reply.status(503).send({ error, reason })
      return
    }
    done()
  })
}
