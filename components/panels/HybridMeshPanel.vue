<template>
  <SidePanel title="Hybrid Mesh" body-class="p-4 space-y-5" @close="$emit('close')">
      <DeclarationSection
        label="Relay"
        description="Public 广播 通过自己可达 Private"
        :items="relayRows"
        empty-text="No relay declarations"
        :highlight="highlight"
        @add="startAdd('RELAY')"
        @edit="row => startEdit('RELAY', row)"
        @remove="(pub, priv) => draftStore.removeRelay(pub, priv)"
      />

      <DeclarationSection
        label="Proxy"
        description="Public 允许 Private 通过 NAT 访问本网络"
        :items="proxyRows"
        empty-text="No proxy declarations"
        :highlight="highlight"
        @add="startAdd('PROXY')"
        @edit="row => startEdit('PROXY', row)"
        @remove="(pub, priv) => draftStore.removeProxy(pub, priv)"
      />

      <DeclarationSection
        label="Gateway"
        description="将 Public 作为整网出口"
        :items="gatewayRows"
        empty-text="No gateway declarations"
        :highlight="highlight"
        @add="startAdd('GATEWAY')"
        @edit="row => startEdit('GATEWAY', row)"
        @remove="(pub, priv) => draftStore.removeGateway(pub, priv)"
      />

      <!-- Default CENTER Gateway (implicit virtual gateway, read-only, folded).
           A peer's implicit CENTER gateway is ENABLED (the virtual gateway stacks
           the domain network onto X→CENTER) unless the peer explicitly roams via
           another exit — then the virtual gateway is disabled for it and X→CENTER
           falls back to CENTER's own host IP (ordinary peer, not a gateway).
           Domain network prefix (v4 + v6) is derived by TopologyModel.getDomainNetworks(). -->
      <div>
        <details class="group">
          <summary class="cursor-pointer select-none flex items-center gap-1.5 text-xs font-medium text-foreground">
            <span class="text-[10px] text-muted-foreground transition-transform duration-150 group-open:rotate-90">▶</span>
            Default CENTER Gateway<span class="text-muted-foreground/60">({{ centerGatewayEdges.length }})</span>
          </summary>
          <p class="text-[10px] text-muted-foreground mt-2 mb-2">默认情况下节点以 CENTER 为 Gateway。<br/>若节点建立了其他 Gateway，则默认 Gateway 将被自动禁用。</p>
          <div class="space-y-1">
            <div
              v-for="e in centerGatewayEdges"
              :key="'cg'+e.id"
              class="flex items-center gap-2 px-2 py-1 rounded-md border"
              :class="e.enabled ? 'bg-muted/30 border-border/50' : 'bg-warning/10 border-warning/50'"
            >
              <span class="text-xs text-foreground truncate">{{ e.name }}</span>
              <span class="text-[10px] text-muted-foreground">→</span>
              <span class="text-xs text-muted-foreground truncate">CENTER</span>
              <span v-if="e.enabled" class="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Default</span>
              <span v-else class="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning">Disabled</span>
            </div>
            <p v-if="!centerGatewayEdges.length" class="text-xs text-muted-foreground">无</p>
          </div>
        </details>
      </div>


      <div class="pt-4 border-t border-border">
        <DeclarationSection
          label="Roaming"
          description="漫游节点经由接入点接入"
          :items="roamingRows"
          empty-text="No roaming entries"
          :highlight="highlight"
          @add="startAdd('ROAMING')"
          @edit="row => startEdit('ROAMING', row)"
          @remove="(pub, priv) => draftStore.removeRoamingEntry(pub, priv)"
        />
      </div>

    <template #footer>
      <button @click="$emit('close')" class="btn-ghost">Close</button>
    </template>

    <template #overlay>
    <ModalShell
      :visible="addModal.visible"
      :title="`${addModal.mode === 'edit' ? 'Edit' : 'Add'} ${addModal.kind === 'RELAY' ? 'Relay' : addModal.kind === 'PROXY' ? 'Proxy' : addModal.kind === 'GATEWAY' ? 'Gateway' : 'Roaming Entry'}`"
      @close="addModal.visible = false"
    >
      <div class="p-4 space-y-4">

        <label class="flex items-center justify-between cursor-pointer pt-1">
          <span class="field-label">Enabled</span>
          <Switch v-model="addModal.enabled" />
        </label>


        <div v-if="addModal.kind === 'RELAY' || addModal.kind === 'PROXY'">
          <label class="field-label">PUBLIC</label>
          <PeerSelect v-model="addModal.pub" :options="peerOptions" />
          <label class="field-label mt-3 block">PRIVATE</label>
          <PeerSelect v-model="addModal.priv" :options="peerOptions" />
        </div>

        <div v-else-if="addModal.kind === 'GATEWAY'">
          <label class="field-label">PRIVATE</label>
          <PeerSelect v-model="addModal.priv" :options="peerOptions" />
          <label class="field-label mt-3 block">PUBLIC</label>
          <PeerSelect v-model="addModal.pub" :options="peerOptions" />
        </div>

        <div v-else-if="addModal.kind === 'ROAMING'">
          <label class="field-label">PRIVATE</label>
          <PeerSelect v-model="addModal.priv" :options="peerOptions" />
          <label class="field-label mt-3 block">PUBLIC</label>
          <PeerSelect v-model="addModal.pub" :options="peerOptions" />
          <label class="field-label mt-3 block">Mode</label>
          <select v-model="addModal.roamType" class="field-input w-full mt-1">
            <option value="flatten">Flatten</option>
            <option value="nat">NAT</option>
          </select>
        </div>

        <div v-if="addError" class="text-xs text-destructive pt-1">{{ addError }}</div>
      </div>

      <template #footer>
        <button @click="addModal.visible = false" class="btn-ghost">Cancel</button>
        <button @click="confirmAdd" :disabled="!canAdd()" class="btn-primary disabled:opacity-40">{{ addModal.mode === 'edit' ? 'Save' : 'Add' }}</button>
      </template>
    </ModalShell>
    </template>
  </SidePanel>
</template>

<script setup lang="ts">
import { useDraft } from '~/composables/useDraft'
import { TopologyModel } from '~/composables/useTopology'
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'

const props = defineProps<{
  graphData: any
  highlight?: { pub: string; priv: string } | null
}>()

const emit = defineEmits<{
  close: []
}>()

const draftStore = useDraft()
const { draft, base } = useDraft()
const model = computed(() => new EasyWGSyncModel(props.graphData))
const nodeName = (id: string) => model.value.getNodeName(id)

const hm = computed(() => draftStore.draft.value.HYBRID_MESH)
const relays = computed(() => hm.value?.DECLARATIONS?.RELAY || [])
const proxies = computed(() => hm.value?.DECLARATIONS?.PROXY || [])
const gateways = computed(() => hm.value?.DECLARATIONS?.GATEWAY || [])
const roaming = computed(() => hm.value?.ROAMING || [])

// Rows for DeclarationSection. RELAY/PROXY display PUBLIC→PRIVATE; GATEWAY/ROAMING
// display PRIVATE→PUBLIC. pub/priv always carry the real PUBLIC/PRIVATE for
// highlight + remove (direction-agnostic).
const relayRows = computed(() => relays.value.map(d => ({ pub: d.PUBLIC_PEER, priv: d.PRIVATE_PEER, left: nodeName(d.PUBLIC_PEER), right: nodeName(d.PRIVATE_PEER), enabled: d.ENABLED !== false })))
const proxyRows = computed(() => proxies.value.map(d => ({ pub: d.PUBLIC_PEER, priv: d.PRIVATE_PEER, left: nodeName(d.PUBLIC_PEER), right: nodeName(d.PRIVATE_PEER), enabled: d.ENABLED !== false })))
const gatewayRows = computed(() => gateways.value.map(d => ({ pub: d.PUBLIC_PEER, priv: d.PRIVATE_PEER, left: nodeName(d.PRIVATE_PEER), right: nodeName(d.PUBLIC_PEER), enabled: d.ENABLED !== false })))
const roamingRows = computed(() => roaming.value.map(r => ({ pub: r.PUBLIC_PEER, priv: r.PRIVATE_PEER, left: nodeName(r.PRIVATE_PEER), right: nodeName(r.PUBLIC_PEER), type: r.TYPE, enabled: r.ENABLED !== false })))

// CENTER default (virtual) Gateway edges, split by state. A peer's implicit
// CENTER Gateway is ENABLED (stacks the domain network onto X→CENTER) when it
// hasn't specified another exit (not PRIVATE of any enabled gateway/roaming);
// DISABLED when it has — X→CENTER falls back to CENTER's own host IP (ordinary
// peer). Domain prefix (v4+v6) is derived, not hardcoded.
const centerGatewayEdges = computed(() => {
  const topo = new TopologyModel(base.value, draft.value)
  const gatewayPrivates = topo.getExplicitGatewayPrivates()
  return (props.graphData?.nodes || [])
    .filter((n: any) => !n.data?.isCenter)
    .map((n: any) => ({ id: n.id, name: nodeName(n.id), enabled: !gatewayPrivates.has(n.id) }))
})

const peerOptions = computed(() => {
  return props.graphData?.nodes
    ?.filter((n: any) => !n.data?.isCenter)
    .map((n: any) => ({ id: n.id, name: nodeName(n.id) })) || []
})

const addModal = reactive({
  visible: false,
  mode: 'add' as 'add' | 'edit',
  kind: '' as 'RELAY' | 'PROXY' | 'GATEWAY' | 'ROAMING',
  pub: '',
  priv: '',
  roamType: 'flatten' as 'flatten' | 'nat',
  enabled: true,
  // the entry being edited (so an in-place edit isn't flagged as a duplicate)
  origPub: '',
  origPriv: '',
})

function startAdd(kind: 'RELAY' | 'PROXY' | 'GATEWAY' | 'ROAMING') {
  Object.assign(addModal, {
    visible: true, mode: 'add', kind,
    pub: '', priv: '', roamType: 'flatten', enabled: true, origPub: '', origPriv: '',
  })
}

// Edit = same modal, the row's current values pre-filled as defaults.
function startEdit(kind: 'RELAY' | 'PROXY' | 'GATEWAY' | 'ROAMING', row: any) {
  Object.assign(addModal, {
    visible: true, mode: 'edit', kind,
    pub: row.pub, priv: row.priv,
    roamType: (row.type as 'flatten' | 'nat') || 'flatten',
    enabled: row.enabled !== false,
    origPub: row.pub, origPriv: row.priv,
  })
}

// Does the same pair already exist in this kind — excluding the entry being edited?
function sameKindExists(pub: string, priv: string): boolean {
  if (addModal.mode === 'edit' && pub === addModal.origPub && priv === addModal.origPriv) return false
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

// Add appends a new entry; edit updates the matching entry IN PLACE so it keeps
// its list position (a remove+add would push it to the bottom).
function confirmAdd() {
  if (!canAdd()) return
  const { mode, kind, pub, priv, roamType, enabled, origPub, origPriv } = addModal
  if (mode === 'edit') {
    if (kind === 'RELAY') draftStore.updateRelay(origPub, origPriv, pub, priv, enabled)
    else if (kind === 'PROXY') draftStore.updateProxy(origPub, origPriv, pub, priv, enabled)
    else if (kind === 'GATEWAY') draftStore.updateGateway(origPub, origPriv, pub, priv, enabled)
    else if (kind === 'ROAMING') draftStore.updateRoamingEntry(origPub, origPriv, pub, priv, roamType, enabled)
  } else {
    if (kind === 'RELAY') draftStore.addRelay(pub, priv, enabled)
    else if (kind === 'PROXY') draftStore.addProxy(pub, priv, enabled)
    else if (kind === 'GATEWAY') draftStore.addGateway(pub, priv, enabled)
    else if (kind === 'ROAMING') draftStore.addRoamingEntry(pub, priv, roamType, enabled)
  }
  addModal.visible = false
}
</script>
