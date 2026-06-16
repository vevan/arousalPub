/**
 * 构建 plugins/{id}/ 下所有带 build.mjs 的插件包。
 * 默认仅重建 src 新于 dist 的插件；传 --force 重建全部。
 */
import { buildPlugins } from './plugin-dist.mjs'

const force = process.argv.includes('--force')

async function main() {
  const built = await buildPlugins({ force })
  if (built.length === 0) {
    console.log('[build:plugins] dist 已是最新（使用 --force 强制全量重建）')
  } else {
    console.log('[build:plugins] done:', built.join(', '))
  }
}

main().catch((e) => {
  console.error('[build:plugins] failed:', e)
  process.exit(1)
})
