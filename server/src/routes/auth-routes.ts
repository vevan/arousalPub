import type { FastifyInstance } from 'fastify'
import { registerAuth } from '../auth.js'

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  await registerAuth(app)
}
