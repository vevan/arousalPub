import ChatConversationView from '@/views/ChatConversationView.vue'
import ConversationListView from '@/views/ConversationListView.vue'
import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: ConversationListView },
    {
      path: '/chat/:conversationId',
      name: 'chat',
      component: ChatConversationView,
      props: true,
    },
    /** 设置改为 App 内全屏/模态，避免离开对话；旧链接仍可用 */
    { path: '/settings', redirect: '/' },
  ],
})
