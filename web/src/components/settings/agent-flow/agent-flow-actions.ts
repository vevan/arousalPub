import type { InjectionKey, Ref } from 'vue'

export type AgentFlowActions = {
  /** preview / disabled 时为 true，节点隐藏编辑按钮 */
  readonly: Ref<boolean>
  editNode: (nodeId: string) => void
  removeNode: (nodeId: string) => void
}

export const agentFlowActionsKey: InjectionKey<AgentFlowActions> =
  Symbol('agentFlowActions')
