/** 向 composer 设置单人 `/@ displayName`（DOC/35 §2.8：一次仅一人） */

import { parseAtSlashDisplayNames } from './composer-slash'

/**
 * 将 `/@` 行设为唯一 `displayName`（替换已有 `/@` 行上的名字），或在文首插入。
 * 若已是该唯一名字则原样返回。正文 remainder 保留。
 */
export function setAtSlashDisplayName(
  raw: string,
  displayName: string,
  boundDisplayNames: readonly string[] = [],
): string {
  const name = displayName.trim()
  if (!name) return raw

  const bound =
    boundDisplayNames.length > 0 ? boundDisplayNames : [name]

  const lines = raw.split('\n')
  const atIdx = lines.findIndex((line) => /^\s*\/@(\s|$)/i.test(line))

  if (atIdx < 0) {
    const body = raw.replace(/^\s+/, '')
    return body ? `/@ ${name}\n${body}` : `/@ ${name}`
  }

  const line = lines[atIdx]!
  const args = line.replace(/^\s*\/@\s*/i, '')
  const { names, remainder } = parseAtSlashDisplayNames(args, bound)
  if (
    names.length === 1 &&
    names[0]!.toLowerCase() === name.toLowerCase()
  ) {
    return raw
  }

  const rebuilt = remainder ? `/@ ${name} ${remainder}` : `/@ ${name}`
  const next = lines.slice()
  next[atIdx] = rebuilt
  return next.join('\n')
}
