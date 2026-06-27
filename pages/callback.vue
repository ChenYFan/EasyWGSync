<template>
  <div class="flex items-center justify-center h-full bg-background">
    <p class="text-sm text-muted-foreground">Signing in…</p>
  </div>
</template>

<script setup lang="ts">
import { setToken } from '~/composables/useAuth'

definePageMeta({ layout: false })

// Casdoor callback lands here with ?token=<id_token>. Store it in localStorage,
// strip it from the URL, then go to the graph.
onMounted(() => {
  const token = useRoute().query.token as string | undefined
  if (token) {
    setToken(token)
    history.replaceState({}, '', '/callback') // drop token from address bar
  }
  navigateTo('/graph', { replace: true })
})
</script>
