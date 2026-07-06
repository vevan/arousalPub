/**
 * 校验 shared/ 源文件与 server/web 副本一致（以 shared 为准）。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const SYNCED_FILES = [
  {
    src: path.join(REPO_ROOT, 'shared', 'group-chat-settings.ts'),
    dests: [
      path.join(REPO_ROOT, 'server', 'src', 'shared', 'group-chat-settings.ts'),
      path.join(REPO_ROOT, 'web', 'src', 'shared', 'group-chat-settings.ts'),
    ],
  },
]

async function fileSha256(filePath) {
  const buf = await readFile(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

async function main() {
  const mismatches = []
  for (const { src, dests } of SYNCED_FILES) {
    const srcHash = await fileSha256(src)
    for (const dest of dests) {
      const destHash = await fileSha256(dest)
      if (srcHash !== destHash) {
        mismatches.push(`${path.relative(REPO_ROOT, dest)} ≠ ${path.relative(REPO_ROOT, src)}`)
      }
    }
  }
  if (mismatches.length > 0) {
    console.error('[verify-shared-sync] out of sync:')
    for (const m of mismatches) console.error(`  - ${m}`)
    console.error('Run: node scripts/sync-all-shared.mjs')
    process.exit(1)
  }
  console.log('[verify-shared-sync] ok')
}

main().catch((e) => {
  console.error('[verify-shared-sync] failed:', e)
  process.exit(1)
})
