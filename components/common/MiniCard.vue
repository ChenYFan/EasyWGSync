<template>
  <div
    class="mini-card h-full rounded-md border border-border bg-card px-3 py-2 cursor-pointer hover:border-foreground/30 transition-colors"
    :class="full ? 'w-full col-span-2' : 'w-full min-w-0'"
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
      <div v-for="(ip, i) in ipLines" :key="i" class="text-[10px] font-mono text-muted-foreground break-all">{{ ip }}</div>
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
import { classifyIP } from '~/composables/useWgConfigParser'

const props = defineProps<{
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

// IPs shown in the card, one per line (comma-split). Each token is validated:
// real IPv4 (with optional CIDR) first, then real IPv6, then anything that is
// neither (kept last so malformed content is surfaced, not silently dropped).
const ipLines = computed(() => {
  const parts = [props.ipv4, props.ipv6]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const v4 = parts.filter(p => classifyIP(p) === 'v4')
  const v6 = parts.filter(p => classifyIP(p) === 'v6')
  const other = parts.filter(p => classifyIP(p) === null)
  return [...v4, ...v6, ...other]
})
</script>
