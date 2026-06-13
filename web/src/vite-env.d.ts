/// <reference types="vite/client" />

declare module 'vuetify/styles'

declare module 'vue-virtual-scroller' {
  import type { Component } from 'vue'

  export const RecycleScroller: Component
  export const DynamicScroller: Component
  export const DynamicScrollerItem: Component
}
