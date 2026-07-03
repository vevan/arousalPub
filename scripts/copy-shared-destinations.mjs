/**
 * 将单个源文件同步到多个目标路径（覆盖写入，避免 cp force 并行 unlink 竞态）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function copyToDestinations(src, dests) {
  const content = await readFile(src)
  for (const dest of dests) {
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, content)
  }
}

export async function copyNamedFilesToDir(srcDir, destDir, names) {
  await mkdir(destDir, { recursive: true })
  for (const name of names) {
    const content = await readFile(path.join(srcDir, name))
    await writeFile(path.join(destDir, name), content)
  }
}
