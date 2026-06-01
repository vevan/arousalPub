import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { resolveWebDistDir } from './config.js'

/** 生产/用户启动：同端口提供 web/dist + SPA 回退 */
export async function registerStaticWeb(app: FastifyInstance): Promise<boolean> {
  const enabled =
    process.env.SERVE_STATIC === '1' || process.env.NODE_ENV === 'production'
  if (!enabled) return false

  const root = resolveWebDistDir()
  if (!root) {
    app.log.warn(
      'SERVE_STATIC 已启用但未找到 web/dist/index.html，仅提供 API',
    )
    return false
  }

  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    decorateReply: true,
  })

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = (request.url.split('?')[0] ?? '').replace(/\/+$/, '') || '/'
    if (pathname.startsWith('/api') || pathname === '/health') {
      return reply.status(404).send({ error: 'not_found' })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.status(404).send({ error: 'not_found' })
    }
    return reply.sendFile('index.html', root)
  })

  app.log.info(`static web: ${root}`)
  return true
}
