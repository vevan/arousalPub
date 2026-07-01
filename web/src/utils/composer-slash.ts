/** Composer 行首 Slash 命令解析（与 turns 正文分离；输入历史仍存 raw） */

export interface SlashGotoCommand {
  kind: 'goto'
  turnOrdinal: number
}

export interface SlashAtCommand {
  kind: 'at'
  /** 已匹配的 displayName（canonical 来自绑定列表） */
  names: string[]
}

export type ParsedSlashCommand = SlashGotoCommand | SlashAtCommand

export interface ComposerSubmitParseResult {
  raw: string
  /** 去掉行首 slash 元指令后的正文（trim 末尾；中间换行保留） */
  body: string
  commands: ParsedSlashCommand[]
}

const SLASH_LINE_RE = /^\s*\//

function parseSlashLineHead(line: string): ParsedSlashCommand | 'unknown' | null {
  const trimmed = line.trim()
  if (!SLASH_LINE_RE.test(trimmed)) return null
  const inner = trimmed.replace(/^\s*\//, '').trim()
  if (!inner) return null

  const space = inner.search(/\s/)
  const head = (space < 0 ? inner : inner.slice(0, space)).toLowerCase()
  const args = space < 0 ? '' : inner.slice(space + 1).trim()

  if (head === 'goto') {
    const token = args.split(/\s+/).find(Boolean) ?? ''
    const n = Number.parseInt(token, 10)
    if (!Number.isFinite(n) || n < 0) return 'unknown'
    return { kind: 'goto', turnOrdinal: n }
  }

  if (head === '@') {
    return { kind: 'at', names: [] }
  }

  return 'unknown'
}

/** 从 `/@` 参数段按空格分词匹配 displayName（与 DOC/35 §2.3 一致） */
export function parseAtSlashDisplayNames(
  argsText: string,
  boundDisplayNames: readonly string[],
): { names: string[]; remainder: string } {
  const byLower = new Map<string, string>()
  for (const raw of boundDisplayNames) {
    const original = raw.trim()
    if (!original) continue
    byLower.set(original.toLowerCase(), original)
  }

  const parts = argsText.trim().split(/\s+/).filter(Boolean)
  const names: string[] = []
  let i = 0
  for (; i < parts.length; i++) {
    const hit = byLower.get(parts[i]!.toLowerCase())
    if (!hit) break
    names.push(hit)
  }
  const remainder = parts.slice(i).join(' ')
  return { names, remainder }
}

export function parseComposerSubmit(
  raw: string,
  opts: { boundDisplayNames?: readonly string[] } = {},
): ComposerSubmitParseResult {
  const boundDisplayNames = opts.boundDisplayNames ?? []
  const commands: ParsedSlashCommand[] = []
  const lines = raw.split('\n')
  let lineIndex = 0
  let atArgsPending = ''

  for (; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    if (!line.trim()) {
      if (commands.length === 0) continue
      break
    }
    if (!SLASH_LINE_RE.test(line)) break

    const parsed = parseSlashLineHead(line)
    if (parsed === null) break
    if (parsed === 'unknown') break

    if (parsed.kind === 'at') {
      const inner = line.trim().replace(/^\s*\//, '').trim()
      const space = inner.indexOf(' ')
      atArgsPending = space < 0 ? '' : inner.slice(space + 1)
      commands.push({ kind: 'at', names: [] })
      continue
    }

    commands.push(parsed)
  }

  const bodyLines = lines.slice(lineIndex)
  let body = bodyLines.join('\n').trim()

  const atIndex = commands.findIndex((c) => c.kind === 'at')
  if (atIndex >= 0) {
    const { names, remainder } = parseAtSlashDisplayNames(atArgsPending, boundDisplayNames)
    commands[atIndex] = { kind: 'at', names }
    if (remainder && !body) {
      body = remainder
    } else if (remainder && body) {
      body = `${remainder}\n${body}`.trim()
    }
  }

  return { raw, body, commands }
}

export function collectSpeakerQueueFromCommands(
  commands: ParsedSlashCommand[],
): string[] {
  const names: string[] = []
  for (const cmd of commands) {
    if (cmd.kind === 'at') names.push(...cmd.names)
  }
  return names
}

/** 是否允许点发送：纯 `/goto` 不要求 API；含正文时仍走聊天发送 */
export function canSubmitComposerInput(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  const { body, commands } = parseComposerSubmit(trimmed)
  if (body.length > 0) return true
  return commands.some((c) => c.kind === 'goto')
}

export interface SubmitComposerResult {
  raw: string
  body: string
  commands: ParsedSlashCommand[]
  speakerQueue: string[]
}

/** 宿主统一入口：解析 raw → 命令 + LLM 可见正文 + speakerQueue */
export function submitComposerParse(
  raw: string,
  opts: { boundDisplayNames?: readonly string[] } = {},
): SubmitComposerResult {
  const parsed = parseComposerSubmit(raw, opts)
  return {
    ...parsed,
    speakerQueue: collectSpeakerQueueFromCommands(parsed.commands),
  }
}
