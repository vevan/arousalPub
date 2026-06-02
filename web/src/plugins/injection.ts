import type { InjectionKey } from 'vue'
import type { usePluginHost } from '@/plugins/usePluginHost'

export type PluginHostContext = ReturnType<typeof usePluginHost>

export const PLUGIN_HOST_KEY: InjectionKey<PluginHostContext> = Symbol('pluginHost')
