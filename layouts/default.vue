<template>
  <div class="min-h-screen bg-background">
    <header class="h-14 border-b border-border flex items-center px-6 justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-sm font-semibold text-foreground">EasyWGSync</h1>
        <span class="text-xs text-muted-foreground font-mono">v1.0</span>
      </div>
      <div class="flex items-center gap-4" v-if="auth.authenticated">
        <button
          v-if="route.path === '/graph'"
          @click="draftStore.previewOpen.value = true"
          class="h-7 px-3 rounded-md text-xs font-medium transition-colors"
          :class="draftStore.isDirty.value
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'border border-border text-muted-foreground hover:text-foreground'"
        >
          Save &amp; Preview
          <span v-if="draftStore.isDirty.value" class="ml-1 opacity-80">●</span>
        </button>
        <button
          @click="toggleDark"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {{ isDark ? '☀ Light' : '● Dark' }}
        </button>
        <span class="text-xs text-muted-foreground">{{ auth.user?.username }}</span>
        <button
          @click="logout"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
const isDark = ref(true)

function toggleDark() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  // Trigger graph repaint for theme-dependent colors
  window.dispatchEvent(new CustomEvent('theme-changed'))
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  clearToken()
  auth.value = { authenticated: false, user: null }
  router.push('/login')
}

onMounted(async () => {
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
