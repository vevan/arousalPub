import { createHash } from 'node:crypto'

/** ST 式稳定 pick：同会话 + 同参数列表 → 恒定选项 */
export function stablePickFromArgs(
  conversationId: string,
  args: string[],
): string {
  if (args.length === 0) return ''
  const seed = `${conversationId}\0${args.join('\0')}`
  const hash = createHash('sha256').update(seed).digest()
  const idx = hash.readUInt32BE(0) % args.length
  return args[idx] ?? ''
}
