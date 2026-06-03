import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { buildMetaPath, writeBuildMeta } from './build-meta.mjs'
import { REPO_ROOT } from './dev-config.mjs'

const metaPath = buildMetaPath(REPO_ROOT)
mkdirSync(path.dirname(metaPath), { recursive: true })
const doc = writeBuildMeta({ repoRoot: REPO_ROOT, metaPath })
const commitLabel = doc.gitCommit ? doc.gitCommit.slice(0, 7) : '(no git)'
const versionLabel = doc.version ?? '(no version)'
console.log(`[build] Recorded build meta @ ${commitLabel} · ${versionLabel}`)
