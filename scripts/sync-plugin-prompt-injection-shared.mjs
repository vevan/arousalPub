/**
 * 将 shared/plugin-prompt-injection.ts 同步到 server 与 web。
 */
import path from 'node:path'
import { copyToDestinations } from './copy-shared-destinations.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'shared', 'plugin-prompt-injection.ts')
const DESTS = [
  path.join(REPO_ROOT, 'server', 'src', 'shared', 'plugin-prompt-injection.ts'),
  path.join(REPO_ROOT, 'web', 'src', 'shared', 'plugin-prompt-injection.ts'),
]

async function main() {
  await copyToDestinations(SRC, DESTS)
  console.log('[sync-plugin-prompt-injection-shared] ok')
}

main().catch((e) => {
  console.error('[sync-plugin-prompt-injection-shared] failed:', e)
  process.exit(1)
})
