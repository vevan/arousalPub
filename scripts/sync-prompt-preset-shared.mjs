/**
 * 将 shared/prompt-preset-normalize.ts 同步到 server 与 web（供 tsc / Vite 引用）。
 */
import path from 'node:path'
import { copyToDestinations } from './copy-shared-destinations.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'shared', 'prompt-preset-normalize.ts')
const DESTS = [
  path.join(REPO_ROOT, 'server', 'src', 'shared', 'prompt-preset-normalize.ts'),
  path.join(REPO_ROOT, 'web', 'src', 'shared', 'prompt-preset-normalize.ts'),
]

async function main() {
  await copyToDestinations(SRC, DESTS)
  console.log('[sync-prompt-preset-shared] ok')
}

main().catch((e) => {
  console.error('[sync-prompt-preset-shared] failed:', e)
  process.exit(1)
})
