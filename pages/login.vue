<template>
  <div class="flex items-center justify-center h-full bg-background">
    <div class="w-full max-w-sm p-8 space-y-6">
      <div class="text-center space-y-2">
        <h1 class="text-2xl font-semibold text-foreground">EasyWGSync</h1>
        <p class="text-sm text-muted-foreground">WireGuard Mesh Configuration Manager</p>
      </div>
      <div v-if="errorMsg" class="px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30">
        <p class="text-xs text-destructive text-center">{{ errorMsg }}</p>
      </div>
      <button
        @click="login"
        class="w-full h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Sign in with Casdoor
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' })

const errorMsg = computed(() => (useRoute().query.error as string) || '')

function login() {
  window.location.href = '/api/auth/login'
}
</script>
