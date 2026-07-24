/**
 * Warn when Git line-ending settings fight this repo's LF policy (.gitattributes eol=lf).
 * Windows + core.autocrlf=true 会导致 plugins/** 等反复出现「无内容 diff」的假脏文件。
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

export function warnIfGitEolMisconfigured() {
  try {
    spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'ignore',
    })
  } catch {
    return
  }
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (inside.status !== 0 || String(inside.stdout).trim() !== 'true') return

  const autocrlf = gitConfig('core.autocrlf').toLowerCase()
  if (autocrlf === 'true') {
    console.warn(
      '[check-git-eol] core.autocrlf=true conflicts with this repo (.gitattributes eol=lf).',
    )
    console.warn(
      '[check-git-eol] Fix (local only): git config core.autocrlf false',
    )
    console.warn(
      '[check-git-eol] Then: git restore .   (or re-clone). See DOC/05 §换行.',
    )
  }
}

const isMain =
  process.argv[1] &&
  /check-git-eol\.mjs$/i.test(process.argv[1].replace(/\\/g, '/'))

if (isMain) {
  warnIfGitEolMisconfigured()
}
