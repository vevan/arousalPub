/**
 * 将 plot-summary 插件 shared 同步到 server/src/plot-summary（供 tsc 编译与 prepare-context 引用）。
 */
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'plugins', 'plot-summary', 'src', 'shared')
const DEST = path.join(REPO_ROOT, 'server', 'src', 'plot-summary')

async function main() {
  await mkdir(DEST, { recursive: true })
  for (const name of ['lorebook-sort.ts', 'prepare-context-blocks.ts']) {
    await cp(path.join(SRC, name), path.join(DEST, name), { force: true })
  }
  console.log('[sync-plot-summary-shared] ok')
}

main().catch((e) => {
  console.error('[sync-plot-summary-shared] failed:', e)
  process.exit(1)
})
