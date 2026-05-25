import BlankRoute from '@/views/BlankRoute.vue'
import ChatConversationView from '@/views/ChatConversationView.vue'
import ConversationListView from '@/views/ConversationListView.vue'
import type {
  NavigationGuardNext,
  RouteLocationNormalized,
} from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

/** 旧链接 /prompts、/characters：回到上一页（或首页）并带上 panel，由 App.vue 打开模态 */
function libraryBeforeEnter(panel: 'prompts' | 'characters') {
  return (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
    next: NavigationGuardNext,
  ) => {
    const fromPath = from.path
    const preserve =
      fromPath &&
      fromPath !== '/prompts' &&
      fromPath !== '/characters' &&
      from.matched.length > 0
        ? fromPath
        : '/'
    next({
      path: preserve,
      query: { ...from.query, ...to.query, panel },
      replace: true,
    })
  }
}

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
    {
      path: '/prompts',
      name: 'prompts',
      beforeEnter: libraryBeforeEnter('prompts'),
      component: BlankRoute,
    },
    {
      path: '/characters',
      name: 'characters',
      beforeEnter: libraryBeforeEnter('characters'),
      component: BlankRoute,
    },
    /** 设置改为 App 内全屏/模态，避免离开对话；旧链接仍可用 */
    { path: '/settings', redirect: '/' },
  ],
})
