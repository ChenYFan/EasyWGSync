<template>
  <div class="flex items-center gap-2 p-3">
    <span class="text-xs font-mono text-muted-foreground">
      {{ edgeData?.primaryGroup || '' }}
    </span>
    <span v-if="edgeData?.hasP2PConfig" class="text-[10px] text-info">P2P</span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  data?: any
}>()

const edgeData = computed(() => props.data)
</script>
