/**
 * 将 shared/hybrid-fts-settings.ts 同步到 server 与 web。
 */
import path from 'node:path'
import { copyToDestinations } from './copy-shared-destinations.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'shared', 'hybrid-fts-settings.ts')
const DESTS = [
  path.join(REPO_ROOT, 'server', 'src', 'shared', 'hybrid-fts-settings.ts'),
  path.join(REPO_ROOT, 'web', 'src', 'shared', 'hybrid-fts-settings.ts'),
]

async function main() {
  await copyToDestinations(SRC, DESTS)
  console.log('[sync-hybrid-fts-settings-shared] ok')
}

main().catch((error) => {
  console.error('[sync-hybrid-fts-settings-shared] failed:', error)
  process.exit(1)
})
