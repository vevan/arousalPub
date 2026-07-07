/** 子进程仅注入插件入口路径 + 运行 Node 所需的最小 OS 环境，避免继承宿主密钥等敏感 env。 */
export const PLUGIN_WORKER_ENTRY_PATH_ENV = 'PLUGIN_WORKER_ENTRY_PATH'

const PASSTHROUGH_KEYS = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_ENV',
] as const

export function buildPluginSandboxChildEnv(entryPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    [PLUGIN_WORKER_ENTRY_PATH_ENV]: entryPath,
  }
  for (const key of PASSTHROUGH_KEYS) {
    const v = process.env[key]
    if (typeof v === 'string' && v.length > 0) {
      env[key] = v
    }
  }
  return env
}
