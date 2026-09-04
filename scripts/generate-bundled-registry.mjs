/**
 * 校验 plugins/bundled-registry.json 与各插件 manifest 一致。
 * 构建时可调用；日常以 committed JSON 为准。
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const REGISTRY_PATH = path.join(REPO_ROOT, 'plugins', 'bundled-registry.json')

/** 新增 bundled 插件时在此维护 order，再运行本脚本写回 JSON */
const BUNDLED_ENTRIES = [
  { id: 'guidance-generate', order: 10, path: 'guidance-generate' },
  { id: 'reply-complete-sound', order: 20, path: 'reply-complete-sound' },
  { id: 'swipe-cleaner', order: 30, path: 'swipe-cleaner' },
  { id: 'conversation-export', order: 40, path: 'conversation-export' },
  { id: 'plot-summary', order: 50, path: 'plot-summary' },
  { id: 'custom-styles', order: 60, path: 'custom-styles' },
  { id: 'trace-keeper', order: 70, path: 'trace-keeper' },
]

async function main() {
  const write = process.argv.includes('--write')
  const missing = []
  for (const entry of BUNDLED_ENTRIES) {
    const manifest = path.join(REPO_ROOT, 'plugins', entry.path, 'manifest.json')
    if (!existsSync(manifest)) {
      missing.push(entry.id)
    }
  }
  if (missing.length) {
    console.error('[generate-bundled-registry] missing manifest:', missing.join(', '))
    process.exit(1)
  }

  const doc = {
    version: 1,
    plugins: [...BUNDLED_ENTRIES].sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    ),
  }

  if (write) {
    await writeFile(REGISTRY_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    console.log('[generate-bundled-registry] wrote', REGISTRY_PATH)
  } else {
    const existing = JSON.parse(await readFile(REGISTRY_PATH, 'utf8'))
    const a = JSON.stringify(doc)
    const b = JSON.stringify(existing)
    if (a !== b) {
      console.error(
        '[generate-bundled-registry] bundled-registry.json out of sync; run with --write',
      )
      process.exit(1)
    }
    console.log('[generate-bundled-registry] ok')
  }
}

main().catch((e) => {
  console.error('[generate-bundled-registry] failed:', e)
  process.exit(1)
})
