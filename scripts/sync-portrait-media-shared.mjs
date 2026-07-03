/**
 * 将 shared/portrait-media-token.ts 同步到 server 与 web。
 */
import path from 'node:path'
import { copyToDestinations } from './copy-shared-destinations.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'shared', 'portrait-media-token.ts')
const DESTS = [
  path.join(REPO_ROOT, 'server', 'src', 'shared', 'portrait-media-token.ts'),
  path.join(REPO_ROOT, 'web', 'src', 'shared', 'portrait-media-token.ts'),
]

async function main() {
  await copyToDestinations(SRC, DESTS)
  console.log('[sync-portrait-media-shared] ok')
}

main().catch((e) => {
  console.error('[sync-portrait-media-shared] failed:', e)
  process.exit(1)
})
