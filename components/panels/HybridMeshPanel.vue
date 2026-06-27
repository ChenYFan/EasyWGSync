<template>
  <div class="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border shadow-xl z-50 flex flex-col">
    <div class="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
      <h3 class="text-sm font-medium text-foreground">高级配置 (Hybrid Mesh)</h3>
      <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-5">
      <!-- RELAY -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Relay (中继)</label>
          <button @click="startAdd('RELAY')" class="text-xs text-muted-foreground hover:text-foreground">+ Add</button>
        </div>
        <p class="text-[10px] text-muted-foreground mb-2">经由 Public 让 Private 可达，纯路由。</p>
        <div class="space-y-1.5">
          <div v-for="(d, i) in relays" :key="'r'+i" class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-background border border-border">
            <span class="text-xs text-foreground truncate">{{ nodeName(d.PUBLIC_PEER) }}</span>
            <span class="text-[10px] text-muted-foreground">→</span>
            <span class="text-xs text-foreground truncate">{{ nodeName(d.PRIVATE_PEER) }}</span>
            <button @click="draftStore.removeRelay(d.PUBLIC_PEER, d.PRIVATE_PEER)" class="ml-auto text-xs text-destructive hover:text-destructive/80">&times;</button>
          </div>
          <p v-if="!relays.length" class="text-xs text-muted-foreground">No relay declarations</p>
        </div>
      </div>

      <!-- PROXY -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Proxy (NAT 代理)</label>
          <button @click="startAdd('PROXY')" class="text-xs text-muted-foreground hover:text-foreground">+ Add</button>
        </div>
        <p class="text-[10px] text-muted-foreground mb-2">让 Private 经由 Public 以 NAT 方式接入。</p>
        <div class="space-y-1.5">
          <div v-for="(d, i) in proxies" :key="'p'+i" class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-background border border-border">
            <span class="text-xs text-foreground truncate">{{ nodeName(d.PUBLIC_PEER) }}</span>
            <span class="text-[10px] text-muted-foreground">→</span>
            <span class="text-xs text-foreground truncate">{{ nodeName(d.PRIVATE_PEER) }}</span>
            <button @click="draftStore.removeProxy(d.PUBLIC_PEER, d.PRIVATE_PEER)" class="ml-auto text-xs text-destructive hover:text-destructive/80">&times;</button>
          </div>
          <p v-if="!proxies.length" class="text-xs text-muted-foreground">No proxy declarations</p>
        </div>
      </div>

      <!-- GATEWAY -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Gateway (网关)</label>
          <button @click="startAdd('GATEWAY')" class="text-xs text-muted-foreground hover:text-foreground">+ Add</button>
        </div>
        <p class="text-[10px] text-muted-foreground mb-2">将 Public 作为整个网络的出口。</p>
        <div class="space-y-1.5">
          <div v-for="(d, i) in gateways" :key="'g'+i" class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-background border border-border">
            <span class="text-xs text-foreground truncate">{{ nodeName(d.PRIVATE_PEER) }}</span>
            <span class="text-[10px] text-muted-foreground">→</span>
            <span class="text-xs text-foreground truncate">{{ nodeName(d.PUBLIC_PEER) }}</span>
            <button @click="draftStore.removeGateway(d.PUBLIC_PEER, d.PRIVATE_PEER)" class="ml-auto text-xs text-destructive hover:text-destructive/80">&times;</button>
          </div>
          <p v-if="!gateways.length" class="text-xs text-muted-foreground">No gateway declarations</p>
        </div>
      </div>

      <!-- ROAMING -->
      <div class="pt-4 border-t border-border">
        <div class="flex items-center justify-between mb-2">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Roaming (漫游)</label>
          <button @click="startAdd('ROAMING')" class="text-xs text-muted-foreground hover:text-foreground">+ Add</button>
        </div>
        <p class="text-[10px] text-muted-foreground mb-2">漫游节点经由接入点接入网络。</p>
        <div class="space-y-1.5">
          <div v-for="(r, i) in roaming" :key="'roam'+i" class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-background border border-border">
            <span class="text-xs text-foreground truncate">{{ nodeName(r.PRIVATE_PEER) }}</span>
            <span class="text-[10px] text-muted-foreground">→</span>
            <span class="text-xs text-foreground truncate">{{ nodeName(r.PUBLIC_PEER) }}</span>
            <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{{ r.TYPE }}</span>
            <button @click="draftStore.removeRoamingEntry(r.PUBLIC_PEER, r.PRIVATE_PEER)" class="ml-auto text-xs text-destructive hover:text-destructive/80">&times;</button>
          </div>
          <p v-if="!roaming.length" class="text-xs text-muted-foreground">No roaming entries</p>
        </div>
      </div>
    </div>

    <div class="h-14 flex items-center justify-end px-4 border-t border-border shrink-0">
      <button @click="$emit('close')" class="h-8 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground">Close</button>
    </div>

    <!-- Add Declaration Modal -->
    <div v-if="addModal.visible" class="fixed inset-0 z-[100] flex items-center justify-center">
      <div class="absolute inset-0 bg-background/80" @click="addModal.visible = false" />
      <div class="relative bg-card border border-border rounded-xl shadow-2xl w-[400px] p-4 space-y-4">
        <h3 class="text-sm font-medium">Add {{ addModal.kind === 'RELAY' ? 'Relay' : addModal.kind === 'PROXY' ? 'Proxy' : addModal.kind === 'GATEWAY' ? 'Gateway' : 'Roaming Entry' }}</h3>

        <div v-if="addModal.kind === 'RELAY' || addModal.kind === 'PROXY'">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">PUBLIC</label>
          <select v-model="addModal.pub" class="mt-1 w-full h-9 px-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Select...</option>
            <option v-for="n in peerOptions" :key="n.id" :value="n.id">{{ n.name }}</option>
          </select>
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground mt-3 block">PRIVATE</label>
          <select v-model="addModal.priv" class="mt-1 w-full h-9 px-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Select...</option>
            <option v-for="n in peerOptions" :key="n.id" :value="n.id">{{ n.name }}</option>
          </select>
        </div>

        <div v-else-if="addModal.kind === 'GATEWAY'">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">PRIVATE</label>
          <select v-model="addModal.priv" class="mt-1 w-full h-9 px-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Select...</option>
            <option v-for="n in peerOptions" :key="n.id" :value="n.id">{{ n.name }}</option>
          </select>
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground mt-3 block">PUBLIC</label>
          <select v-model="addModal.pub" class="mt-1 w-full h-9 px-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Select...</option>
            <option v-for="n in peerOptions" :key="n.id" :value="n.id">{{ n.name }}</option>
          </select>
        </div>

        <div v-else-if="addModal.kind === 'ROAMING'">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">PRIVATE</label>
          <select v-model="addModal.priv" class="mt-1 w-full h-9 px-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Select...</option>
            <option v-for="n in peerOptions" :key="n.id" :value="n.id">{{ n.name }}</option>
          </select>
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground mt-3 block">PUBLIC</label>
          <select v-model="addModal.pub" class="mt-1 w-full h-9 px-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Select...</option>
            <option v-for="n in peerOptions" :key="n.id" :value="n.id">{{ n.name }}</option>
          </select>
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground mt-3 block">Mode</label>
          <select v-model="addModal.roamType" class="mt-1 w-full h-9 px-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="flatten">Flatten (Relay+Gateway, 无 NAT)</option>
            <option value="nat">NAT (Proxy+Gateway, MASQUERADE)</option>
          </select>
        </div>

        <div v-if="addError" class="text-xs text-destructive pt-1">{{ addError }}</div>
        <div class="flex justify-end gap-2 pt-2">
          <button @click="addModal.visible = false" class="h-8 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button @click="confirmAdd" :disabled="!canAdd()" class="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40">Add</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDraft } from '~/composables/useDraft'

const props = defineProps<{
  graphData: any
}>()

const emit = defineEmits<{
  close: []
}>()

const draftStore = useDraft()

const hm = computed(() => draftStore.draft.value.HYBRID_MESH)
const relays = computed(() => hm.value?.DECLARATIONS?.RELAY || [])
const proxies = computed(() => hm.value?.DECLARATIONS?.PROXY || [])
const gateways = computed(() => hm.value?.DECLARATIONS?.GATEWAY || [])
const roaming = computed(() => hm.value?.ROAMING || [])

const peerOptions = computed(() => {
  return props.graphData?.nodes
    ?.filter((n: any) => !n.data?.isCenter)
    .map((n: any) => ({ id: n.id, name: n.data?.fileName || n.id.slice(0, 12) })) || []
})

function nodeName(id: string): string {
  const n = props.graphData?.nodes?.find((n: any) => n.id === id)
  return n?.data?.fileName || id.slice(0, 12)
}

const addModal = reactive({
  visible: false,
  kind: '' as 'RELAY' | 'PROXY' | 'GATEWAY' | 'ROAMING',
  pub: '',
  priv: '',
  roamType: 'flatten' as 'flatten' | 'nat',
})

function startAdd(kind: 'RELAY' | 'PROXY' | 'GATEWAY' | 'ROAMING') {
  addModal.visible = true
  addModal.kind = kind
  addModal.pub = ''
  addModal.priv = ''
  addModal.roamType = 'flatten'
}

// Does the same pair already exist in the SAME kind being added?
function sameKindExists(pub: string, priv: string): boolean {
  const h = hm.value
  if (!h) return false
  if (addModal.kind === 'ROAMING') {
    return (h.ROAMING || []).some(r => r.PUBLIC_PEER === pub && r.PRIVATE_PEER === priv)
  }
  const list = h.DECLARATIONS?.[addModal.kind as 'RELAY' | 'PROXY' | 'GATEWAY'] || []
  return list.some(d => d.PUBLIC_PEER === pub && d.PRIVATE_PEER === priv)
}

function canAdd(): boolean {
  if (!addModal.pub || !addModal.priv || addModal.pub === addModal.priv) return false
  // Same-kind duplicate not allowed (Relay/Proxy/Gateway can coexist for a pair)
  if (sameKindExists(addModal.pub, addModal.priv)) return false
  return true
}

const addError = computed(() => {
  if (!addModal.pub || !addModal.priv) return ''
  if (addModal.pub === addModal.priv) return 'PUBLIC 和 PRIVATE 不能是同一节点'
  if (sameKindExists(addModal.pub, addModal.priv)) {
    return `该 ${addModal.kind} 声明已存在`
  }
  return ''
})

function confirmAdd() {
  if (!canAdd()) return
  const { kind, pub, priv, roamType } = addModal
  if (kind === 'RELAY') draftStore.addRelay(pub, priv)
  else if (kind === 'PROXY') draftStore.addProxy(pub, priv)
  else if (kind === 'GATEWAY') draftStore.addGateway(pub, priv)
  else if (kind === 'ROAMING') draftStore.addRoamingEntry(pub, priv, roamType)
  addModal.visible = false
}
</script>
