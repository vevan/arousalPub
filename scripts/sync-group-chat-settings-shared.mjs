/**
 * 将 shared/group-chat-settings.ts 同步到 server 与 web（供 tsc / Vite 引用）。
 */
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'shared', 'group-chat-settings.ts')
const DESTS = [
  path.join(REPO_ROOT, 'server', 'src', 'shared', 'group-chat-settings.ts'),
  path.join(REPO_ROOT, 'web', 'src', 'shared', 'group-chat-settings.ts'),
]

async function main() {
  for (const dest of DESTS) {
    await mkdir(path.dirname(dest), { recursive: true })
    await cp(SRC, dest, { force: true })
  }
  console.log('[sync-group-chat-settings-shared] ok')
}

main().catch((e) => {
  console.error('[sync-group-chat-settings-shared] failed:', e)
  process.exit(1)
})
