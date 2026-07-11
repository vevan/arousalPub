/**
 * DOC/41 · 宿主目录禁止出现 bundled 插件 id 字面量。
 * 用法：node scripts/check-host-no-plugin-ids.mjs [--json]
 * 退出码：0 无违规；1 有违规。
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

/** bundled 第一方插件 id（与 DOC/42 一致） */
const BUNDLED_PLUGIN_IDS = [
  'trace-keeper',
  'plot-summary',
  'guidance-generate',
  'curated-memory',
]

const ID_PATTERN = new RegExp(BUNDLED_PLUGIN_IDS.join('|'), 'i')

const SEMANTIC_NAME_PATTERN =
  /TraceKeeper|PlotSummary|Historian|patchTraceKeeper|regenerateSeparate|removeTraceKeeper/i

const SCAN_ROOTS = [
  'server/src',
  'web/src/plugins',
  'web/src/components/settings',
  'web/src/utils/persist-display.ts',
  'web/src/utils/chat-api.ts',
  'web/src/types/chat-turn.ts',
  'shared',
  'server/test',
  'web/test',
]

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git'])

const SKIP_PATH_PARTS = ['fixture-plugin-']

const SOURCE_EXT = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs'])

function shouldSkipRelative(relPosix) {
  if (relPosix.endsWith('.md')) return true
  return SKIP_PATH_PARTS.some((part) => relPosix.includes(part))
}

function filenameViolation(relPosix) {
  const base = path.posix.basename(relPosix)
  for (const id of BUNDLED_PLUGIN_IDS) {
    if (base.includes(id)) {
      return { kind: 'filename', id, line: 0, text: base }
    }
  }
  return null
}

async function collectFiles(absPath, relFromRoot) {
  const out = []
  let stat
  try {
    stat = await import('node:fs/promises').then((fs) => fs.stat(absPath))
  } catch {
    return out
  }

  if (stat.isFile()) {
    const ext = path.extname(absPath)
    if (SOURCE_EXT.has(ext) && !shouldSkipRelative(relFromRoot.replace(/\\/g, '/'))) {
      out.push({ abs: absPath, rel: relFromRoot.replace(/\\/g, '/') })
    }
    return out
  }

  if (!stat.isDirectory()) return out

  const entries = await readdir(absPath, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.isDirectory() && SKIP_DIR_NAMES.has(ent.name)) continue
    const childAbs = path.join(absPath, ent.name)
    const childRel = path.join(relFromRoot, ent.name)
    out.push(...(await collectFiles(childAbs, childRel)))
  }
  return out
}

async function scanFile(file) {
  const hits = []
  const fnHit = filenameViolation(file.rel)
  if (fnHit) {
    hits.push({ ...fnHit, file: file.rel })
  }

  let text
  try {
    text = await readFile(file.abs, 'utf8')
  } catch {
    return hits
  }

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    if (ID_PATTERN.test(line)) {
      hits.push({
        kind: 'plugin-id',
        file: file.rel,
        line: lineNo,
        text: line.trim().slice(0, 120),
      })
    } else if (SEMANTIC_NAME_PATTERN.test(line)) {
      hits.push({
        kind: 'semantic-name',
        file: file.rel,
        line: lineNo,
        text: line.trim().slice(0, 120),
      })
    }
  }
  return hits
}

async function main() {
  const jsonOut = process.argv.includes('--json')
  const files = []

  for (const root of SCAN_ROOTS) {
    const abs = path.join(REPO_ROOT, root)
    const rel = root.replace(/\\/g, '/')
    files.push(...(await collectFiles(abs, rel)))
  }

  const allHits = []
  for (const file of files) {
    allHits.push(...(await scanFile(file)))
  }

  allHits.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  )

  if (jsonOut) {
    console.log(JSON.stringify({ violations: allHits, count: allHits.length }, null, 2))
  } else if (allHits.length === 0) {
    console.log('[check:host-no-plugin-ids] OK — no violations')
  } else {
    console.error(
      `[check:host-no-plugin-ids] FAIL — ${allHits.length} violation(s) (DOC/42 · DOC/41 §8)\n`,
    )
    for (const h of allHits) {
      const loc = h.line ? `${h.file}:${h.line}` : h.file
      console.error(`  [${h.kind}] ${loc}`)
      if (h.text) console.error(`    ${h.text}`)
    }
    console.error('\nSee DOC/42-host-generic-audit-checklist.md for remediation')
  }

  process.exit(allHits.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[check:host-no-plugin-ids] error:', e)
  process.exit(2)
})
