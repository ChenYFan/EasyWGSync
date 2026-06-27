<template>
  <div class="min-h-screen bg-background">
    <header class="h-14 border-b border-border flex items-center px-3 sm:px-6 justify-between gap-2">
      <div class="flex items-center gap-2 sm:gap-3 min-w-0">
        <!-- Hamburger: toggles the off-canvas sidebar on the graph page below lg. -->
        <button
          v-if="auth.authenticated && route.path === '/graph'"
          @click="toggleSidebar"
          class="lg:hidden h-8 w-8 -ml-1 grid place-items-center rounded-md text-foreground hover:bg-secondary transition-colors"
          aria-label="Toggle menu"
        >
          <span class="text-lg leading-none">☰</span>
        </button>
        <h1 class="text-sm font-semibold text-foreground truncate">EasyWGSync</h1>
      </div>
      <div class="flex items-center gap-1.5 sm:gap-2 shrink-0" v-if="auth.authenticated">

        <button
          v-if="route.path === '/graph'"
          @click="draftStore.previewOpen.value = true"
          class="h-7 px-3 rounded-md text-xs font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
        >
        <span class="hidden sm:inline">Save &amp; Preview</span>
        <span class="sm:hidden">Save</span>
        <span v-if="draftStore.isDirty.value" class="ml-1 opacity-80">●</span>
        </button>

        <button
          v-if="route.path === '/graph'"
          @click="nodePositions.clear()"
          class="h-7 px-2.5 grid place-items-center rounded-md text-xs font-medium border border-border text-foreground bg-secondary/40 hover:bg-secondary transition-colors"
          title="将所有节点恢复到默认布局位置"
        >
          <span class="hidden sm:inline">Reset Positions</span>
          <span class="sm:hidden text-sm leading-none">↺</span>
        </button>

        <span v-if="route.path === '/graph'" class="w-px h-5 bg-border mx-0.5 sm:mx-1" />

        <button
          @click="toggleDark"
          class="h-7 w-7 grid place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          :title="isDark ? '切换到亮色' : '切换到暗色'"
        >
          {{ isDark ? '☀' : '☾' }}
        </button>
        <span class="hidden sm:inline-flex h-7 items-center gap-1.5 px-2.5 rounded-md bg-secondary/40 text-xs text-foreground max-w-[140px]">
          <span class="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
          <span class="truncate">{{ auth.user?.username }}</span>
        </span>
        <button
          @click="logout"
          class="h-7 px-3 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
    <main class="h-[calc(100vh-3.5rem)]">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useDraft } from '~/composables/useDraft'
import { authFetch, clearToken } from '~/composables/useAuth'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const draftStore = useDraft()
const nodePositions = useNodePositions()
const { toggleSidebar } = useUiState()
const isDark = ref(true)
const THEME_KEY = 'easywgsync-theme'

function applyDark(dark: boolean) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
  // Trigger graph repaint for theme-dependent colors
  window.dispatchEvent(new CustomEvent('theme-changed'))
}

function toggleDark() {
  applyDark(!isDark.value)
  if (import.meta.client) localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light')
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  clearToken()
  auth.value = { authenticated: false, user: null }
  router.push('/login')
}

onMounted(async () => {
  // Restore persisted theme (default dark when unset).
  const saved = localStorage.getItem(THEME_KEY)
  applyDark(saved ? saved === 'dark' : true)

  const session = await authFetch('/api/auth/session') as any
  auth.value = session
  // Skip redirect when Casdoor is not configured (dev mode bypass)
  if (!session.authenticated && session.bypass) {
    auth.value = { authenticated: true, user: { userId: 'dev', username: 'dev' } }
    return
  }
  if (!session.authenticated && useRoute().path !== '/login') {
    router.push('/login')
  }
})
</script>
