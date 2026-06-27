<template>
  <div
    v-if="visible"
    class="fixed z-[100] bg-card border border-border rounded-lg shadow-xl py-1 min-w-[220px]"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
  >
    <!-- Header: what was selected -->
    <div class="px-3 py-2 border-b border-border">
      <p class="text-[10px] uppercase tracking-wider text-muted-foreground">
        你选中了一个{{ typeLabel }}
      </p>
      <p class="text-sm font-medium text-foreground truncate mt-0.5">{{ headerName }}</p>
      <p v-if="headerSub" class="text-[11px] text-muted-foreground truncate">{{ headerSub }}</p>
    </div>

    <!-- Node menu -->
    <template v-if="type === 'node'">
      <div class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Group</div>
      <button class="menu-item" @click="emit('add-to-group')">Add to Group…</button>
      <button class="menu-item" @click="emit('remove-from-group')">Remove from Group…</button>
      <div class="my-1 border-t border-border" />
      <div class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Network</div>
      <button class="menu-item" @click="emit('traceroute')">Mock TraceRoute</button>
      <button class="menu-item" @click="emit('relay-for')">Relay for…</button>
    </template>

    <!-- Group menu -->
    <template v-if="type === 'group'">
      <div class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Action</div>
      <button class="menu-item" @click="emit('add-peer')">Add Peer to ({{ headerName }})</button>
      <button class="menu-item text-destructive" @click="emit('delete-group')">Delete Group ({{ headerName }})</button>
    </template>

    <!-- Connection menu -->
    <template v-if="type === 'connection'">
      <div class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Network</div>
      <button class="menu-item" @click="emit('set-gateway')">Set ({{ connTarget }}) As Gateway for ({{ connSource }})</button>
      <button class="menu-item text-destructive" @click="emit('set-default')">Set As Default</button>
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean
  x: number
  y: number
  type: 'node' | 'group' | 'connection' | null
  headerName?: string
  headerSub?: string
  connSource?: string
  connTarget?: string
}>()

const emit = defineEmits<{
  close: []
  'add-to-group': []
  'remove-from-group': []
  'relay-for': []
  'traceroute': []
  'add-peer': []
  'delete-group': []
  'set-gateway': []
  'set-default': []
}>()

const typeLabel = computed(() => {
  switch (props.type) {
    case 'node': return '节点'
    case 'group': return '组'
    case 'connection': return '连接'
    default: return ''
  }
})
</script>

<style scoped>
.menu-item {
  @apply w-full px-3 py-1.5 text-sm text-left text-foreground hover:bg-secondary transition-colors;
}
</style>
