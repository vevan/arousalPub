/**
 * 终端可点击超链接（OSC 8）+ ANSI 着色；非 TTY 或 NO_COLOR 时回退纯文本 URL。
 * @param {string} url
 * @param {string} [label]
 */
export function formatTerminalLink(url, label = url) {
  const esc = '\u001b'
  const bel = '\u0007'
  return `${esc}]8;;${url}${bel}${label}${esc}]8;;${bel}`
}

/**
 * @param {string} url
 * @param {{ label?: string, prefix?: string }} [options]
 */
export function printTerminalLink(url, options = {}) {
  const label = options.label ?? url
  const prefix = options.prefix ?? ''

  if (prefix) process.stdout.write(prefix)

  if (!process.stdout.isTTY || process.env.NO_COLOR) {
    console.log(label)
    if (label !== url) console.log(url)
    return
  }

  const linked = formatTerminalLink(url, label)
  console.log(`\x1b[36m\x1b[4m${linked}\x1b[0m`)
}
