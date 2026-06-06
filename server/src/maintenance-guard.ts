import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from './api-error-codes.js'
import { shouldBlockWriteForMaintenance } from './maintenance-lock.js'

/** 全局维护写锁：拒绝 /api/* 写操作（admin/auth 除外） */
export function registerMaintenanceGuard(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    if (
      shouldBlockWriteForMaintenance(request.method, request.url)
    ) {
      void reply.status(503).send({
        error: ApiErrorCodes.maintenance_mode,
        reason: 'dek_rotation',
      })
      return
    }
    done()
  })
}
