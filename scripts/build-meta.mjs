import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './dev-config.mjs'

export const BUILD_META_REL = path.join('server', 'dist', 'build-meta.json')

export function buildMetaPath(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, BUILD_META_REL)
}

/** @returns {string | null} full commit hash, or null if not a git repo / git unavailable */
export function getGitHeadCommit(repoRoot = REPO_ROOT) {
  if (!existsSync(path.join(repoRoot, '.git'))) return null
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (r.status !== 0) return null
  const hash = r.stdout.trim()
  return hash || null
}

/** @returns {string | null} committer date as ISO 8601 (%cI), or null */
export function getGitHeadCommitDate(repoRoot = REPO_ROOT) {
  if (!existsSync(path.join(repoRoot, '.git'))) return null
  const r = spawnSync('git', ['log', '-1', '--format=%cI', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (r.status !== 0) return null
  const iso = r.stdout.trim()
  return iso || null
}

/** @returns {{ version: string | null, gitCommit: string | null, gitCommitDate: string | null, builtAt: string | null } | null} */
export function readBuildMeta(metaPath = buildMetaPath()) {
  if (!existsSync(metaPath)) return null
  try {
    const doc = JSON.parse(readFileSync(metaPath, 'utf8'))
    const gitCommit =
      typeof doc.gitCommit === 'string' && doc.gitCommit.trim()
        ? doc.gitCommit.trim()
        : null
    const gitCommitDate =
      typeof doc.gitCommitDate === 'string' && doc.gitCommitDate.trim()
        ? doc.gitCommitDate.trim()
        : null
    const version =
      typeof doc.version === 'string' && doc.version.trim()
        ? doc.version.trim()
        : gitCommitDate
    const builtAt =
      typeof doc.builtAt === 'string' && doc.builtAt.trim()
        ? doc.builtAt.trim()
        : null
    return { version, gitCommit, gitCommitDate, builtAt }
  } catch {
    return null
  }
}

export function writeBuildMeta(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const metaPath = options.metaPath ?? buildMetaPath(repoRoot)
  const gitCommit = getGitHeadCommit(repoRoot)
  const gitCommitDate = getGitHeadCommitDate(repoRoot)
  const doc = {
    version: gitCommitDate,
    gitCommit,
    gitCommitDate,
    builtAt: new Date().toISOString(),
  }
  writeFileSync(metaPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  return doc
}

/**
 * True when repo has git, build meta is missing/unstamped, or HEAD !== recorded commit.
 * Skipped when .git is unavailable (e.g. zip checkout).
 */
export function isBuildStaleForGit(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const current = getGitHeadCommit(repoRoot)
  if (!current) return false

  const meta = readBuildMeta(options.metaPath ?? buildMetaPath(repoRoot))
  if (!meta?.gitCommit) return true

  return meta.gitCommit !== current
}
