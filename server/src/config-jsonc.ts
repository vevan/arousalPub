/** 剥离 JSONC 行注释与块注释，供 config.json 解析；字符串内不剥离。 */
export function stripJsonComments(text: string): string {
  let out = ''
  let i = 0
  let inString = false
  let escaped = false

  while (i < text.length) {
    const c = text[i]!
    const next = text[i + 1]

    if (inString) {
      out += c
      if (escaped) {
        escaped = false
      } else if (c === '\\') {
        escaped = true
      } else if (c === '"') {
        inString = false
      }
      i++
      continue
    }

    if (c === '"') {
      inString = true
      out += c
      i++
      continue
    }

    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++
      continue
    }

    if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++
      }
      i += 2
      continue
    }

    out += c
    i++
  }
  return out
}
