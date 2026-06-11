const ESC_OPEN = '\uE000'
const ESC_CLOSE = '\uE001'

/** `\{\{` / `\}\}` 或 `\{` `\{` 逐字符转义 → 占位符，渲染后还原为字面花括号 */
export function preprocessMacroEscapes(text: string): string {
  if (!text.includes('\\')) return text
  let result = ''
  let i = 0
  while (i < text.length) {
    if (
      text[i] === '\\' &&
      text[i + 1] === '{' &&
      text[i + 2] === '\\' &&
      text[i + 3] === '{'
    ) {
      result += ESC_OPEN
      i += 4
      continue
    }
    if (
      text[i] === '\\' &&
      text[i + 1] === '}' &&
      text[i + 2] === '\\' &&
      text[i + 3] === '}'
    ) {
      result += ESC_CLOSE
      i += 4
      continue
    }
    if (text[i] === '\\' && text[i + 1] === '{' && text[i + 2] === '{') {
      result += ESC_OPEN
      i += 3
      continue
    }
    if (text[i] === '\\' && text[i + 1] === '}' && text[i + 2] === '}') {
      result += ESC_CLOSE
      i += 3
      continue
    }
    result += text[i]!
    i += 1
  }
  return result
}

export function restoreMacroEscapes(text: string): string {
  if (!text.includes(ESC_OPEN) && !text.includes(ESC_CLOSE)) return text
  return text
    .replaceAll(ESC_OPEN, '{{')
    .replaceAll(ESC_CLOSE, '}}')
}
