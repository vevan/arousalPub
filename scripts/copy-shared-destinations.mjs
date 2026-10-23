/**
 * 将单个源文件同步到多个目标路径（覆盖写入，避免 cp force 并行 unlink 竞态）。
 * 生成副本一律写 LF：源文件在 Windows 上可能被编辑器写成 CRLF，副本不应继承，
 * 否则 `git add` 会报 "CRLF will be replaced by LF"。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

function toLfBytes(content) {
  return Buffer.from(content.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8')
}

export async function copyToDestinations(src, dests) {
  const content = toLfBytes(await readFile(src))
  for (const dest of dests) {
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, content)
  }
}

export async function copyNamedFilesToDir(srcDir, destDir, names) {
  await mkdir(destDir, { recursive: true })
  for (const name of names) {
    const content = toLfBytes(await readFile(path.join(srcDir, name)))
    await writeFile(path.join(destDir, name), content)
  }
}
