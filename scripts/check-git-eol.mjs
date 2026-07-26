/**
 * Ensure Git line endings match this repo's LF policy (.gitattributes eol=lf).
 * Windows + effective core.autocrlf=true 会与 eol=lf 打架，出现「无内容 diff」的假脏文件。
 * 启动路径（ensure-deps）会自动把本仓库本地设为 core.autocrlf=false（不改全局）。
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

function gitConfig(key) {
  const r = spawnSync('git', ['config', '--get', key], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (r.status !== 0) return ''
  return String(r.stdout ?? '').trim()
}

function gitLocalConfig(key) {
  const r = spawnSync('git', ['config', '--local', '--get', key], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (r.status !== 0) return ''
  return String(r.stdout ?? '').trim()
}

function setLocalAutocrlfFalse() {
  const r = spawnSync('git', ['config', '--local', 'core.autocrlf', 'false'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return r.status === 0
}

function refreshIndexStatCache() {
  spawnSync('git', ['update-index', '-q', '--refresh'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'ignore',
  })
}

/**
 * If effective core.autocrlf is true, set local override to false and refresh index.
 * @returns {{ fixed: boolean, skipped: boolean }}
 */
export function ensureGitEolConfigured() {
  try {
    const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (inside.status !== 0 || String(inside.stdout).trim() !== 'true') {
      return { fixed: false, skipped: true }
    }
  } catch {
    return { fixed: false, skipped: true }
  }

  const effective = gitConfig('core.autocrlf').toLowerCase()
  if (effective !== 'true') {
    return { fixed: false, skipped: true }
  }

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
    console.warn('[check-git-eol] See DOC/05 §换行.')
    return { fixed: false, skipped: false }
  }

  refreshIndexStatCache()
  console.warn(
    '[check-git-eol] Local core.autocrlf=false applied. If status still looks dirty with empty diffs, run: git add -u',
  )
  return { fixed: true, skipped: false }
}

const isMain =
  process.argv[1] &&
  /check-git-eol\.mjs$/i.test(process.argv[1].replace(/\\/g, '/'))

if (isMain) {
  ensureGitEolConfigured()
}
