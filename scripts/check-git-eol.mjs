/**
 * Ensure Git line endings match this repo's LF policy (.gitattributes eol=lf).
 * Windows + effective core.autocrlf=true 会与 eol=lf 打架，出现「无内容 diff」的假脏文件。
 * 启动路径（ensure-deps）会自动把本仓库本地设为 core.autocrlf=false（不改全局），
 * 并把被编辑器/工具写成 CRLF 的已跟踪文本文件归一化回 LF（*.bat / *.cmd 例外）。
 * 归一化只改写工作区副本，内容与索引中的 LF blob 等价，故 git status / git diff 保持干净。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

/** .gitattributes keeps CRLF for Windows batch files. */
const KEEP_CRLF = /\.(bat|cmd)$/i

function git(args, options = {}) {
  return spawnSync('git', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  })
}

function gitConfig(key) {
  const r = git(['config', '--get', key])
  if (r.status !== 0) return ''
  return String(r.stdout ?? '').trim()
}

function gitLocalConfig(key) {
  const r = git(['config', '--local', '--get', key])
  if (r.status !== 0) return ''
  return String(r.stdout ?? '').trim()
}

function setLocalAutocrlfFalse() {
  const r = git(['config', '--local', 'core.autocrlf', 'false'])
  return r.status === 0
}

/** Git refreshes cached stat info only for explicitly listed paths on
 *  Windows; a bare `--refresh` leaves the entries reported as modified.
 *  This never stages content: rewritten files match the index blobs. */
const REFRESH_BATCH = 100

function refreshIndexStatCache(paths = []) {
  if (paths.length === 0) {
    git(['update-index', '-q', '--refresh'], { stdio: 'ignore' })
    return
  }
  for (let i = 0; i < paths.length; i += REFRESH_BATCH) {
    const batch = paths.slice(i, i + REFRESH_BATCH)
    git(['update-index', '-q', '--really-refresh', '--', ...batch], {
      stdio: 'ignore',
    })
  }
}

function isInsideWorkTree() {
  try {
    const r = git(['rev-parse', '--is-inside-work-tree'])
    return r.status === 0 && String(r.stdout ?? '').trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Tracked text files whose working copy has CRLF while the index holds LF
 * (`git ls-files --eol` reports `w/crlf` or `w/mixed`).
 */
function listTrackedCrlfFiles() {
  const r = git(['-c', 'core.quotepath=false', 'ls-files', '--eol'])
  if (r.status !== 0 || !r.stdout) return []
  const files = []
  for (const line of String(r.stdout).split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const meta = line.slice(0, tab)
    // Keyword expansions differ per platform: match the worktree state plus
    // the explicit text attribute, so binaries are never rewritten.
    if (!/\bw\/(crlf|mixed)\b/.test(meta)) continue
    if (!/\battr\/text/.test(meta)) continue
    const file = line.slice(tab + 1).trimEnd()
    if (!file || KEEP_CRLF.test(file)) continue
    files.push(file)
  }
  return files
}

/**
 * @param {Buffer} buffer
 * @returns {Buffer | null} LF copy, or null when already LF
 */
function toLf(buffer) {
  const text = buffer.toString('utf8')
  const normalized = text.replace(/\r\n?/g, '\n')
  return normalized === text ? null : Buffer.from(normalized, 'utf8')
}

/**
 * Normalize working-copy line endings of tracked text files to LF.
 * @returns {{ fixed: number, files: string[], skipped: boolean }}
 */
export function normalizeWorktreeEol() {
  if (!isInsideWorkTree()) return { fixed: 0, files: [], skipped: true }
  const rewritten = []
  for (const file of listTrackedCrlfFiles()) {
    try {
      const lf = toLf(readFileSync(file))
      if (!lf) continue
      writeFileSync(file, lf)
      rewritten.push(file)
    } catch {
      // Locked or unreadable file: leave it, the next run retries.
    }
  }
  if (rewritten.length > 0) {
    console.warn(
      `[check-git-eol] Normalized ${rewritten.length} tracked file(s) from CRLF to LF (repo policy: LF).`,
    )
    console.warn('[check-git-eol] See DOC/devNotes/05 §换行.')
  }
  return { fixed: rewritten.length, files: rewritten, skipped: false }
}

/**
 * If effective core.autocrlf is true, set local override to false; then
 * normalize any CRLF working copies back to LF.
 * @returns {{ fixed: boolean, skipped: boolean }}
 */
export function ensureGitEolConfigured() {
  if (!isInsideWorkTree()) return { fixed: false, skipped: true }

  let fixed = false
  const effective = gitConfig('core.autocrlf').toLowerCase()
  if (effective === 'true') {
    const local = gitLocalConfig('core.autocrlf').toLowerCase()
    console.warn(
      '[check-git-eol] core.autocrlf=true conflicts with this repo (.gitattributes eol=lf).',
    )
    if (local === 'true') {
      console.warn(
        '[check-git-eol] Local core.autocrlf was true; setting local core.autocrlf=false …',
      )
    } else {
      console.warn(
        '[check-git-eol] Global/system autocrlf=true; setting local override core.autocrlf=false …',
      )
    }

    if (!setLocalAutocrlfFalse()) {
      console.warn(
        '[check-git-eol] Failed to set local config. Run manually: git config core.autocrlf false',
      )
      console.warn('[check-git-eol] See DOC/devNotes/05 §换行.')
    } else {
      fixed = true
      console.warn(
        '[check-git-eol] Local core.autocrlf=false applied. If status still looks dirty with empty diffs, run: git add -u',
      )
    }
  }

  const normalized = normalizeWorktreeEol()
  if (normalized.fixed > 0) fixed = true
  if (fixed) refreshIndexStatCache(normalized.files)
  return { fixed, skipped: false }
}

const isMain =
  process.argv[1] &&
  /check-git-eol\.mjs$/i.test(process.argv[1].replace(/\\/g, '/'))

if (isMain) {
  ensureGitEolConfigured()
}
