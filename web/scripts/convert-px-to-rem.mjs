/**
 * 将 web/src 下 .vue / .css 中的 CSS 长度 px 转为 rem（1rem = 16px）。
 * 0px → 0。不处理 .ts（避免误伤字符串）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..', 'src')

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(vue|css)$/i.test(e.name)) acc.push(p)
  }
  return acc
}

function pxToRem(_, numStr) {
  const n = parseFloat(numStr)
  if (Number.isNaN(n)) return `${numStr}px`
  if (n === 0) return '0'
  const rem = n / 16
  const rounded = Math.round(rem * 10000) / 10000
  return `${rounded}rem`
}

let total = 0
for (const file of walk(root)) {
  const before = fs.readFileSync(file, 'utf8')
  const after = before.replace(/(\d*\.?\d+)px/g, pxToRem)
  if (after !== before) {
    fs.writeFileSync(file, after)
    total++
    console.log(path.relative(path.join(__dirname, '..'), file))
  }
}
console.log(`Updated ${total} files.`)
