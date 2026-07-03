/**
 * 将 plot-summary 插件 shared 同步到 server/src/plot-summary（供 tsc 编译与 prepare-context 引用）。
 */
import path from 'node:path'
import { copyNamedFilesToDir } from './copy-shared-destinations.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const SRC = path.join(REPO_ROOT, 'plugins', 'plot-summary', 'src', 'shared')
const DEST = path.join(REPO_ROOT, 'server', 'src', 'plot-summary')

async function main() {
  await copyNamedFilesToDir(SRC, DEST, [
    'lorebook-sort.ts',
    'prepare-context-blocks.ts',
  ])
  console.log('[sync-plot-summary-shared] ok')
}

main().catch((e) => {
  console.error('[sync-plot-summary-shared] failed:', e)
  process.exit(1)
})
