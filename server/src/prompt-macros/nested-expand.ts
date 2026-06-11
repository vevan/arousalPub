/** 自内向外展开嵌套 `{{…}}`（ST 语义：内层宏先求值） */

const INNERMOST = /\{\{([^{}]+)\}\}/

export function expandNestedMacros(
  text: string,
  expandToken: (inner: string) => string,
  maxRounds = 64,
): string {
  if (!text.includes('{{')) return text
  let current = text
  for (let round = 0; round < maxRounds; round++) {
    const m = INNERMOST.exec(current)
    if (!m || m.index === undefined) return current
    const full = m[0]
    const inner = m[1]!
    const replacement = expandToken(inner)
    const next =
      current.slice(0, m.index) + replacement + current.slice(m.index + full.length)
    if (next === current) return current
    current = next
  }
  return current
}
