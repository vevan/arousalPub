import CharactersView from '@/views/CharactersView.vue'
import ChatConversationView from '@/views/ChatConversationView.vue'
import ConversationListView from '@/views/ConversationListView.vue'
import PromptsView from '@/views/PromptsView.vue'
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
    { path: '/prompts', name: 'prompts', component: PromptsView },
    { path: '/characters', name: 'characters', component: CharactersView },
    /** 设置改为 App 内全屏/模态，避免离开对话；旧链接仍可用 */
    { path: '/settings', redirect: '/' },
  ],
})
