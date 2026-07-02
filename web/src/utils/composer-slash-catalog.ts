/** Slash 命令目录（补全 UI + 与 registry 插件项合并） */

export interface ComposerSlashCommandSpec {
  id: string
  /** 第一行展示：命令 + 示例参数 */
  example: string
  /** i18n key */
  descriptionKey: string
  source: 'builtin' | 'plugin'
}

export const BUILTIN_COMPOSER_SLASH_COMMANDS: ComposerSlashCommandSpec[] = [
  {
    id: 'goto',
    example: '/goto 3',
    descriptionKey: 'chat.slash.commands.goto.description',
    source: 'builtin',
  },
  {
    id: '@',
    example: '/@ Alice Betty',
    descriptionKey: 'chat.slash.commands.at.description',
    source: 'builtin',
  },
]

export function filterComposerSlashCommands(
  commands: ComposerSlashCommandSpec[],
  query: string,
): ComposerSlashCommandSpec[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands.slice()
  return commands.filter((c) => {
    const id = c.id.toLowerCase()
    if (id.startsWith(q)) return true
    if (c.example.toLowerCase().includes(q)) return true
    return false
  })
}

export function mergeComposerSlashCatalog(
  pluginSpecs: ComposerSlashCommandSpec[],
  boundDisplayNames: readonly string[] = [],
): ComposerSlashCommandSpec[] {
  const seen = new Set<string>()
  const out: ComposerSlashCommandSpec[] = []
  const names = boundDisplayNames.map((n) => n.trim()).filter(Boolean)
  const atExample =
    names.length >= 2
      ? `/@ ${names[0]} ${names[1]}`
      : names.length === 1
        ? `/@ ${names[0]}`
        : '/@ Alice Betty'
  for (const c of [...BUILTIN_COMPOSER_SLASH_COMMANDS, ...pluginSpecs]) {
    const key = c.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (c.id === '@') {
      out.push({ ...c, example: atExample })
    } else {
      out.push(c)
    }
  }
  return out
}
