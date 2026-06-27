<template>
  <div
    class="mini-card rounded-md border border-border bg-card px-3 py-2 cursor-pointer hover:border-foreground/30 transition-colors"
    :class="full ? 'w-full' : 'w-[calc(50%-0.375rem)] min-w-0'"
    @click="$emit('click')"
  >
    <!-- Node type: name, pubkey, ip (ipv6 only if no ipv4) -->
    <template v-if="type === 'node'">
      <div class="flex items-center gap-1.5">
        <span class="text-sm font-medium text-card-foreground" style="overflow-wrap: break-word; word-break: break-word;">{{ name.replaceAll('_', '_​') }}</span>
        <span v-if="virtual" class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">Virtual</span>
      </div>
      <div v-if="comment" class="text-[10px] text-muted-foreground mt-0.5 italic" style="overflow-wrap: break-word;">{{ comment }}</div>
      <div v-if="pubkey" class="text-[10px] font-mono text-muted-foreground mt-0.5 break-all">{{ pubkey }}</div>
      <div v-if="ipv4" class="text-[10px] font-mono text-muted-foreground break-all">{{ ipv4 }}</div>
      <div v-else-if="!ipv4 && ipv6" class="text-[10px] font-mono text-muted-foreground break-all">{{ ipv6 }}</div>
    </template>

    <!-- Group type: group name, color dot, member count -->
    <template v-if="type === 'group'">
      <div class="flex items-center gap-1.5">
        <span
          class="w-2.5 h-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: color || 'hsl(0 0% 40%)' }"
        />
        <span v-if="virtual" class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">Virtual</span>
        <span class="text-sm font-medium text-card-foreground" style="overflow-wrap: break-word; word-break: break-word;">{{ name.replaceAll('_', '_​') }}</span>
        <span v-if="count !== undefined" class="ml-auto text-[10px] text-muted-foreground shrink-0">{{ count }}</span>
      </div>
      <div v-if="comment" class="text-[10px] text-muted-foreground mt-0.5 italic" style="overflow-wrap: break-word;">{{ comment }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  type: 'node' | 'group'
  name: string
  full?: boolean
  virtual?: boolean
  comment?: string
  // Node props
  pubkey?: string
  ipv4?: string
  ipv6?: string
  // Group props
  color?: string
  count?: number
}>()

defineEmits<{
  click: []
}>()
</script>
