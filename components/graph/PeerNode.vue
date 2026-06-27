<template>
  <div class="peer-node px-4 py-3 rounded-lg border bg-card shadow-sm"
    :style="{ opacity: data.vopacity ?? 1 }"
    :class="{
      'selected': data.selected,
      'border-border': !data.selected && !data.isCenter,
      'border-foreground': data.selected,
      'border-foreground/60 ring-1 ring-foreground/20': data.isCenter && !data.selected,
    }"
  >
    <!-- Multiple handles distributed along edges for natural closest-point connection -->
    <Handle v-for="h in handles" :key="h.id"
      :id="h.id"
      :type="h.type"
      :position="h.position"
      class="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0"
      :style="h.style"
    />
    <div class="flex items-center gap-2 mb-2">
      <span
        class="w-2 h-2 rounded-full shrink-0"
        :class="data.isOnline ? 'bg-emerald-500' : 'bg-neutral-600'"
      />
      <span class="text-sm font-semibold text-card-foreground whitespace-nowrap">
        {{ data.displayName }}
      </span>
    </div>
    <table class="text-[11px] font-mono leading-relaxed">
      <tbody>
      <tr>
        <td class="text-muted-foreground pr-2 whitespace-nowrap align-top">公钥</td>
        <td class="text-foreground/80 whitespace-nowrap">{{ data.publicKey }}</td>
      </tr>
      <tr v-if="ipv4">
        <td class="text-muted-foreground pr-2 whitespace-nowrap">IPv4</td>
        <td class="text-foreground/80 whitespace-nowrap">{{ ipv4 }}</td>
      </tr>
      <tr v-if="ipv6">
        <td class="text-muted-foreground pr-2 whitespace-nowrap">IPv6</td>
        <td class="text-foreground/80 whitespace-nowrap">{{ ipv6 }}</td>
      </tr>
      <tr v-if="data.endpoint && data.endpoint !== 'none'">
        <td class="text-muted-foreground pr-2 whitespace-nowrap">端点</td>
        <td class="text-foreground/80 whitespace-nowrap" v-text="data.endpoint"></td>
      </tr>
      </tbody>
    </table>
    <div v-if="data.groups?.length" class="flex gap-1.5 mt-2 flex-wrap">
      <span
        v-for="group in data.groups"
        :key="group"
        class="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground"
      >
        <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: getGroupColor(group) }" />
        {{ group }}
      </span>
    </div>
    <div v-if="data.relays?.length || data.proxies?.length" class="flex gap-1.5 mt-1.5 flex-wrap">
      <span
        v-for="relayed in data.relays"
        :key="'r-' + relayed.id"
        class="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border border-purple-500/40 bg-purple-500/10 text-purple-400"
      >
        <span>Relay: [{{ relayed.name }}]</span>
      </span>
      <span
        v-for="proxied in data.proxies"
        :key="'p-' + proxied.id"
        class="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-400"
      >
        <span>Proxy: [{{ proxied.name }}]</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { getGroupColor } from '~/composables/useMeshGraph'

const props = defineProps<{
  data: {
    publicKey: string
    displayName: string
    address?: string
    endpoint: string | null
    isOnline: boolean
    groups: string[]
    relays?: Array<{ id: string; name: string }>
    proxies?: Array<{ id: string; name: string }>
    vopacity?: number
    vstate?: string
    selected?: boolean
    isCenter?: boolean
  }
}>()

// 16 handle points: 3 per side + 4 corners. Same IDs used for both source and target.
const handles = computed(() => {
  const result: { id: string; type: 'source' | 'target'; position: Position; style: Record<string, string> }[] = []

  const addPoint = (id: string, position: Position, style: Record<string, string>) => {
    result.push({ id, type: 'source', position, style })
    result.push({ id, type: 'target', position, style })
  }

  // Top edge: exit/enter vertically
  for (const pct of [25, 50, 75]) {
    addPoint(`source-t-${pct}`, Position.Top, { left: `${pct}%`, top: '0' })
  }
  // Bottom edge: exit/enter vertically
  for (const pct of [25, 50, 75]) {
    addPoint(`source-b-${pct}`, Position.Bottom, { left: `${pct}%`, bottom: '0', top: 'auto' })
  }
  // Left edge: exit/enter horizontally
  for (const pct of [25, 50, 75]) {
    addPoint(`source-l-${pct}`, Position.Left, { top: `${pct}%`, left: '0' })
  }
  // Right edge: exit/enter horizontally
  for (const pct of [25, 50, 75]) {
    addPoint(`source-r-${pct}`, Position.Right, { top: `${pct}%`, right: '0', left: 'auto' })
  }
  // Corners: top corners exit upward, bottom corners exit downward
  addPoint('source-tl', Position.Top, { left: '0', top: '0' })
  addPoint('source-tr', Position.Top, { left: '100%', top: '0' })
  addPoint('source-bl', Position.Bottom, { left: '0', bottom: '0', top: 'auto' })
  addPoint('source-br', Position.Bottom, { left: '100%', bottom: '0', top: 'auto' })

  return result
})

const ipv4 = computed(() => {
  if (!props.data.address) return null
  const parts = props.data.address.split(',').map(s => s.trim())
  return parts.find(p => p.includes('.')) || null
})

const ipv6 = computed(() => {
  if (!props.data.address) return null
  const parts = props.data.address.split(',').map(s => s.trim())
  return parts.find(p => p.includes(':')) || null
})
</script>

<style scoped>
.peer-node {
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, opacity 0.3s;
  width: max-content;
}
.peer-node:hover {
  border-color: hsl(0 0% 35%);
  box-shadow: 0 0 0 1px hsl(0 0% 25%);
}
.peer-node.selected {
  border-color: hsl(var(--foreground)) !important;
  box-shadow: 0 0 12px 2px hsl(var(--foreground) / 0.3), 0 0 4px 1px hsl(var(--foreground) / 0.5);
}
</style>
