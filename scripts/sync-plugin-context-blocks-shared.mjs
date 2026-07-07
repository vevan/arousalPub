/**
 * 将 shared/plugin-context-blocks.ts 同步到 server 与 web。
 */
import path from 'node:path'
import { copyToDestinations } from './copy-shared-destinations.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'shared', 'plugin-context-blocks.ts')
const DESTS = [
  path.join(REPO_ROOT, 'server', 'src', 'shared', 'plugin-context-blocks.ts'),
  path.join(REPO_ROOT, 'web', 'src', 'shared', 'plugin-context-blocks.ts'),
]

async function main() {
  await copyToDestinations(SRC, DESTS)
  console.log('[sync-plugin-context-blocks-shared] ok')
}

main().catch((e) => {
  console.error('[sync-plugin-context-blocks-shared] failed:', e)
  process.exit(1)
})
