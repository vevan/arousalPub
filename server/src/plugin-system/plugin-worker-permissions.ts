import path from 'node:path'

/**
 * 子进程 Node 启动参数：--permission + 只读插件包与 bootstrap 目录。
 * 默认禁 child_process / worker_threads / addons / fs 写。
 */
export function buildPluginSandboxExecArgv(
  entryPath: string,
  bootstrapPath: string,
): string[] {
  if (isPluginSandboxPermissionDisabled()) {
    return []
  }

  const resolvedEntry = path.resolve(entryPath)
  const pluginRoot = path.dirname(path.dirname(resolvedEntry))
  const bootstrapDir = path.dirname(path.resolve(bootstrapPath))

  const argv = ['--permission']
  for (const dir of new Set([pluginRoot, bootstrapDir])) {
    argv.push(`--allow-fs-read=${dir}`)
  }
  return argv
}

function isPluginSandboxPermissionDisabled(): boolean {
  const v = process.env.PLUGIN_SERVER_SANDBOX_NO_PERMISSION?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
