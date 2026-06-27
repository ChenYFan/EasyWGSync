<template>
  <div
    class="group-node rounded-xl border-2 border-dashed p-4 w-full h-full"
    :style="{
      borderColor: data.color,
      backgroundColor: data.color + '20',
      opacity: gop,
    }"
  >
    <div class="flex items-center gap-2">
      <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: data.color }" />
      <span class="text-xs font-medium uppercase tracking-wide" :style="{ color: data.color }">
        {{ data.label }}
      </span>
      <span class="text-[10px] ml-auto" :style="{ color: data.color }">
        {{ data.memberCount }} peers
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  data: {
    label: string
    color: string
    memberCount: number
    isActive: boolean
    gopacity?: number
    vstate?: string
  }
}>()

// Overall group-frame visibility driven by the unified state opacity:
// selected 1 / semi 0.4 / normal 0.1 / dimmed 0.03
const gop = computed(() => props.data.gopacity ?? 0.1)
</script>

<style scoped>
.group-node {
  pointer-events: none;
  transition: opacity 0.3s;
}
</style>
