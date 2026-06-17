/**
 * 插件 esbuild 共用：文本资源行尾归一化，保证 dist 跨平台字节一致。
 */
import { readFile } from 'node:fs/promises'

/** CRLF / CR → LF */
export function normalizeTextEOL(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

const TEXT_RESOURCE_RE = /\.(hbs|css)$/

/** 接管 .hbs / .css，嵌入 dist 前统一 LF（勿与 loader 里 text 重复配置） */
export function normalizeTextEolPlugin() {
  return {
    name: 'plugin-normalize-text-eol',
    setup(build) {
      build.onLoad({ filter: TEXT_RESOURCE_RE }, async (args) => {
        const text = await readFile(args.path, 'utf8')
        return { contents: normalizeTextEOL(text), loader: 'text' }
      })
    },
  }
}

export const PLUGIN_JSON_LOADER = { '.json': 'json' }
