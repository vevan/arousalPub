/**
 * 将 shared/post-user-injection-order.ts 同步到 server 与 web。
 */
import path from 'node:path'
import { copyToDestinations } from './copy-shared-destinations.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'shared', 'post-user-injection-order.ts')
const DESTS = [
  path.join(REPO_ROOT, 'server', 'src', 'shared', 'post-user-injection-order.ts'),
  path.join(REPO_ROOT, 'web', 'src', 'shared', 'post-user-injection-order.ts'),
]

async function main() {
  await copyToDestinations(SRC, DESTS)
  console.log('[sync-post-user-injection-order-shared] ok')
}

main().catch((e) => {
  console.error('[sync-post-user-injection-order-shared] failed:', e)
  process.exit(1)
})
