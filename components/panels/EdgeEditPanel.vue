<template>
  <div class="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border shadow-xl z-50 flex flex-col">
    <div class="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-medium text-foreground">Edit Connection</h3>
        <span v-if="!hasConfig" class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Default</span>
        <span v-if="isGateway" class="text-[9px] px-1.5 py-0.5 rounded-full border border-purple-500/40 bg-purple-500/10 text-purple-400">Gateway</span>
      </div>
      <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Direction: full-width node cards -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Direction</label>
        <div class="mt-1.5 space-y-2">
          <MiniCard
            type="node"
            :name="srcInfo.name"
            :pubkey="srcInfo.pubkey"
            :ipv4="srcInfo.ipv4"
            :comment="srcInfo.comment"
            :virtual="srcInfo.isVirtual"
            full
            @click="$emit('select-node', edge.source)"
          />
          <div class="text-center text-xs text-muted-foreground py-0.5">↓</div>
          <MiniCard
            type="node"
            :name="tgtInfo.name"
            :pubkey="tgtInfo.pubkey"
            :ipv4="tgtInfo.ipv4"
            :comment="tgtInfo.comment"
            :virtual="tgtInfo.isVirtual"
            full
            @click="$emit('select-node', edge.target)"
          />
        </div>
      </div>

      <!-- Read-only notice for Center→peer direction -->
      <div v-if="isFromCenter" class="px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
        <p class="text-xs text-yellow-400">此方向（Center → 节点）不可编辑。请编辑 节点 → Center 方向的连接。</p>
      </div>

      <!-- Editable fields (hidden for read-only Center→peer direction) -->
      <template v-if="!isFromCenter">
      <!-- Groups -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Groups</label>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <MiniCard
            v-for="g in sharedGroups"
            :key="g.name"
            type="group"
            :name="g.name"
            :color="getGroupColor(g.name)"
            :virtual="g.virtual"
            :full="g.virtual"
            :comment="g.comment"
            @click="$emit('select-group', g.name)"
          />
        </div>
      </div>

      <!-- Endpoint -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Endpoint</label>
        <input
          v-model="form.ENDPOINT"
          class="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="ip:port or 'none'"
        />
      </div>

      <!-- AllowedIPs -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Allowed IPs</label>
        <div class="mt-1 space-y-1">
          <div v-for="(_, i) in form.ALLOWED_IPS" :key="i" class="flex gap-1">
            <input
              v-model="form.ALLOWED_IPS[i]"
              class="flex-1 h-8 px-2 rounded border border-input bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button @click="form.ALLOWED_IPS.splice(i, 1)" class="shrink-0 w-8 h-8 rounded-md border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center transition-colors text-base leading-none">&times;</button>
          </div>
          <button
            @click="form.ALLOWED_IPS.push('')"
            class="text-xs text-muted-foreground hover:text-foreground"
          >+ Add IP</button>
        </div>
      </div>

      <!-- PersistentKeepalive -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Persistent Keepalive</label>
        <input
          v-model.number="form.PERSISTENT_KEEPALIVE"
          type="number"
          class="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="21"
        />
      </div>

      <!-- Reset button -->
      <div v-if="hasConfig" class="pt-2">
        <button
          @click="handleReset"
          class="w-full h-8 rounded-md border border-destructive/30 text-xs text-destructive hover:bg-destructive/10"
        >Reset to Default</button>
      </div>
      </template>
    </div>

    <div class="h-14 flex items-center justify-end gap-2 px-4 border-t border-border shrink-0">
      <button
        @click="$emit('close')"
        class="h-8 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >Cancel</button>
      <button
        v-if="!isFromCenter"
        @click="handleSave"
        class="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
      >Save</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getGroupColor } from '~/composables/useMeshGraph'
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'

const props = defineProps<{
  edge: any
  graphData: any
}>()

const emit = defineEmits<{
  close: []
  save: [source: string, target: string, data: any]
  reset: [source: string, target: string]
  'select-node': [nodeId: string]
  'select-group': [groupName: string]
}>()

const model = computed(() => new EasyWGSyncModel(props.graphData))

const srcInfo = computed(() => model.value.getPeerDisplayInfo(props.edge.source, props.edge.source))
const tgtInfo = computed(() => model.value.getPeerDisplayInfo(props.edge.target, props.edge.source))
const hasConfig = computed(() => model.value.hasP2PConfig(props.edge.source, props.edge.target))
const isGateway = computed(() => !!props.edge?.data?.isGateway)
const isFromCenter = computed(() => !!props.edge?.data?.isFromCenter)

const sharedGroups = computed(() => {
  const groups = model.value.getSharedGroups(props.edge.source, props.edge.target)
  return groups.map(name => ({
    name,
    virtual: model.value.isVirtualGroup(name),
    comment: model.value.getGroup(name)?.comment || '',
  })).sort((a, b) => {
    if (a.virtual && !b.virtual) return -1
    if (!a.virtual && b.virtual) return 1
    return 0
  })
})

const form = reactive({
  ENDPOINT: '',
  ALLOWED_IPS: [] as string[],
  PERSISTENT_KEEPALIVE: null as number | null,
})

// Load existing P2P config
onMounted(() => {
  const p2p = props.edge?.data
  if (p2p) {
    form.ENDPOINT = p2p.p2pEndpoint || ''
    form.ALLOWED_IPS = [...(p2p.p2pAllowedIPs || [])]
  }
})

function handleSave() {
  const data: any = {}
  if (form.ENDPOINT) data.ENDPOINT = form.ENDPOINT
  const ips = form.ALLOWED_IPS.filter(ip => ip.trim())
  if (ips.length > 0) data.ALLOWED_IPS = ips
  if (form.PERSISTENT_KEEPALIVE) data.PERSISTENT_KEEPALIVE = form.PERSISTENT_KEEPALIVE
  emit('save', props.edge.source, props.edge.target, data)
}

function handleReset() {
  emit('reset', props.edge.source, props.edge.target)
}
</script>
