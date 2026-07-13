import BlankRoute from '@/views/BlankRoute.vue'
import type {
  NavigationGuardNext,
  RouteLocationNormalized,
} from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

type LibraryPanel = 'prompts' | 'characters' | 'lorebooks' | 'files'

/** 旧链接 /prompts、/characters：回到上一页（或首页）并带上 panel，由 App.vue 打开模态 */
function libraryBeforeEnter(panel: LibraryPanel) {
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
      fromPath !== '/lorebooks' &&
      fromPath !== '/files' &&
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
    { path: '/', name: 'home', component: () => import('@/views/ConversationListView.vue') },
    {
      path: '/chat/:conversationId',
      name: 'chat',
      component: () => import('@/views/ChatConversationView.vue'),
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
    {
      path: '/lorebooks',
      name: 'lorebooks',
      beforeEnter: libraryBeforeEnter('lorebooks'),
      component: BlankRoute,
    },
    {
      path: '/files',
      name: 'files',
      beforeEnter: libraryBeforeEnter('files'),
      component: BlankRoute,
    },
    /** 设置改为 App 内全屏/模态，避免离开对话；旧链接仍可用 */
    { path: '/settings', redirect: '/' },
  ],
})
