/**
 * 将 shared/turn-plugin-merge.ts 同步到 server。
 */
import path from 'node:path'
import { copyToDestinations } from './copy-shared-destinations.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'shared', 'turn-plugin-merge.ts')
const DESTS = [
  path.join(REPO_ROOT, 'server', 'src', 'shared', 'turn-plugin-merge.ts'),
]

async function main() {
  await copyToDestinations(SRC, DESTS)
  console.log('[sync-turn-plugin-merge-shared] ok')
}

main().catch((e) => {
  console.error('[sync-turn-plugin-merge-shared] failed:', e)
  process.exit(1)
})
