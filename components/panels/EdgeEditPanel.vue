<template>
  <SidePanel title="Edit Connection" body-class="p-4 space-y-3" @close="$emit('close')">
    <template #header-extra>
      <span v-if="!hasConfig && !decl.isGatewayDeclared" class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Default</span>
      <StatusChip v-if="decl.isGatewayDeclared" level="important">Gateway</StatusChip>
    </template>

      <div class="space-y-3 pb-3 border-b border-border">
        <div>
          <label class="field-label">Direction</label>
          <div class="mt-1.5 space-y-2">
            <MiniCard type="node" :name="srcInfo.name" :pubkey="srcInfo.pubkey" :ipv4="srcInfo.ipv4" :comment="srcInfo.comment" :virtual="srcInfo.isVirtual" full @click="$emit('select-node', edge.source)" />
            <div class="text-center text-xs text-muted-foreground py-0.5">↓</div>
            <MiniCard type="node" :name="tgtInfo.name" :pubkey="tgtInfo.pubkey" :ipv4="tgtInfo.ipv4" :comment="tgtInfo.comment" :virtual="tgtInfo.isVirtual" full @click="$emit('select-node', edge.target)" />
          </div>
        </div>
        <div v-if="sharedGroups.length">
          <label class="field-label">Groups</label>
          <CardGrid class="mt-1.5">
            <MiniCard v-for="g in sharedGroups" :key="g.name" type="group" :name="g.name" :color="getGroupColor(g.name)" :virtual="g.virtual" :full="g.virtual" :comment="g.comment" @click="$emit('select-group', g.name)" />
          </CardGrid>
        </div>
      </div>

      <StatusBox v-if="isFromCenter" level="warning">
        <p class="text-xs text-warning">此方向（Center → 节点）不可编辑，请编辑反向连接。</p>
      </StatusBox>

      <!-- Editable connection. Gateway/Roaming-declared edges are STILL editable:
           the declaration is an additive read-only layer that stacks on top of
           the manual (extraConf) layer in the preview — it never locks the edge. -->
      <template v-else>
        <StatusBox v-if="decl.noUnderlyingConnection" level="error">
          <p class="text-xs text-error">此 Gateway/Roaming 声明缺少底层直接连接，两端不在同一组。请先将两端加入同一组，否则配置不生效。</p>
        </StatusBox>
        <StatusBox v-if="decl.isGatewayDeclared" level="important">
          <p class="text-xs text-important">{{ tgtInfo.name }} 由 Gateway/Roaming 声明为整网出口，整域 IP 叠加在「高级+」层。</p>
        </StatusBox>

        <CollapsibleSection title="Network" open>
            <div>
              <label class="field-label">Endpoint</label>
              <input v-model="form.ENDPOINT" class="mt-1 w-full field-input font-mono" :placeholder="placeholders.endpoint" />
            </div>
            <div>
              <div class="flex items-center justify-between">
                <label class="field-label">Allowed IPs</label>
                <ModeToggle v-model="form.ALLOWED_IPS_MODE" />
              </div>
              <div class="mt-1 space-y-1">
                <div v-for="(_ip, i) in form.ALLOWED_IPS" :key="i" class="flex gap-1">
                  <input v-model="form.ALLOWED_IPS[i]" :placeholder="placeholders.allowedIp(i)" class="flex-1 h-8 px-2 rounded border border-input bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  <button @click="form.ALLOWED_IPS.splice(i, 1)" class="shrink-0 w-8 h-8 rounded-md border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center transition-colors text-base leading-none">&times;</button>
                </div>
                <button @click="form.ALLOWED_IPS.push('')" class="text-xs text-muted-foreground hover:text-foreground">+ Add IP</button>
              </div>
            </div>
            <div>
              <label class="field-label">Persistent Keepalive</label>
              <input v-model="form.PERSISTENT_KEEPALIVE" class="mt-1 w-full field-input font-mono" :placeholder="placeholders.keepalive" />
            </div>
        </CollapsibleSection>

        <CollapsibleSection title="Final Configuration" open body-class="space-y-2">
            <LayeredField label="Endpoint" :conv="layers.ENDPOINT" />
            <LayeredField label="Allowed IPs" :conv="layers.ALLOWED_IPS" wrap="comma" />
            <LayeredField label="Persistent Keepalive" :conv="layers.PERSISTENT_KEEPALIVE" />
        </CollapsibleSection>

        <button v-if="decl.isGatewayDeclared" @click="$emit('goto-hybrid', { pub: edge.target, priv: edge.source })" class="w-full h-9 rounded-md border border-important/40 bg-important/10 text-important text-xs font-medium hover:bg-important/20 transition-colors">
          在 Hybrid Mesh 中管理声明 →
        </button>

        <div v-if="hasConfig" class="pt-1">
          <button @click="handleReset" class="w-full btn-danger">Reset to Default</button>
        </div>
      </template>

    <template #footer>
      <button @click="$emit('close')" class="btn-ghost">Cancel</button>
      <button v-if="!isFromCenter" @click="handleSave" class="btn-primary">Save</button>
    </template>
  </SidePanel>
</template>

<script setup lang="ts">
import { getGroupColor } from '~/composables/useMeshGraph'
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'
import { useDraft } from '~/composables/useDraft'
import { TopologyModel } from '~/composables/useTopology'
import { ConnectionConfigModel, type ConnectionForm, type DefaultConnection } from '~/composables/useConfigModel'
import { connDeclOf, convergeField } from '~/composables/useRenderModel'

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
  'goto-hybrid': [payload: { pub: string; priv: string }]
}>()

const { draft, base, renderModel } = useDraft()
const model = computed(() => new EasyWGSyncModel(props.graphData))

const srcInfo = computed(() => model.value.getPeerDisplayInfo(props.edge.source, props.edge.source))
const tgtInfo = computed(() => model.value.getPeerDisplayInfo(props.edge.target, props.edge.source))
const isFromCenter = computed(() => !!props.edge?.data?.isFromCenter)
const isToCenter = computed(() => !!props.edge?.data?.isToCenter)

const p2pKey = computed(() => isToCenter.value ? 'CENTRAL_NODE' : props.edge.target)

// "Has manual config" must reflect the STORED draft (provenance), NOT the
// rendered graph edge — renderHybridMesh materializes the CENTER /24 baseline
// onto every edge, so edge.data.hasP2PConfig is true for all CENTER edges.
const hasConfig = computed(() => {
  const p2p = draft.value.EXTRA_CONFIG?.[props.edge.source]?.P2P_CONFIG?.[p2pKey.value]
  if (!p2p) return false
  return !!(p2p.ENDPOINT || (p2p.ALLOWED_IPS && p2p.ALLOWED_IPS.length) || p2p.PERSISTENT_KEEPALIVE != null)
})

const defaultConn = computed<DefaultConnection>(() => {
  const g = base.value.globalDefaults || {}
  const keepalive = g.peer_keep_alive || '21'
  if (isToCenter.value) {
    // X→CENTER default = CENTER's own host IPs (/32+/128, ordinary peer) — matches
    // the renderer's default layer (mechanism A). The /24 gateway stack is a
    // declaration layer (center-gateway), NOT the default. endpoint = CENTER's
    // dial address from the global fixed source (remote_endpoint:ListenPort).
    const topo = new TopologyModel(base.value, draft.value)
    return { endpoint: topo.getCenterDialEndpoint() || '', allowedIPs: topo.getCenterOwnIPs(), keepalive }
  }
  const tgtDefault = base.value.basePeers.find(p => p.publicKey === props.edge.target)?.default
  return { endpoint: base.value.onlineEndpoints?.[props.edge.target] || '', allowedIPs: tgtDefault?.address || [], keepalive }
})

const confLayer = computed(() => draft.value.EXTRA_CONFIG?.[props.edge.source]?.P2P_CONFIG?.[p2pKey.value])
const decl = computed(() => connDeclOf(renderModel.value, props.edge.source, props.edge.target, p2pKey.value))

const cfgModel = computed(() => new ConnectionConfigModel(defaultConn.value, confLayer.value))
const placeholders = computed(() => cfgModel.value.getPlaceholders())

// Live preview: splice the in-progress form value into the cached changelog
// (default + declaration from the single renderModel), then converge.
function extraRawOf(field: string): string {
  if (field === 'ENDPOINT') return form.ENDPOINT.trim()
  if (field === 'PERSISTENT_KEEPALIVE') return form.PERSISTENT_KEEPALIVE.trim()
  const items = form.ALLOWED_IPS.map(s => s.trim()).filter(Boolean)
  if (form.ALLOWED_IPS_MODE === 'append') return items.length ? `@ ${items.join(', ')}` : '@'
  return items.join(', ')
}
const layers = computed(() => {
  const id = `${props.edge.source}|${p2pKey.value}`
  const out: Record<string, ReturnType<typeof convergeField>> = {}
  for (const f of ['ENDPOINT', 'ALLOWED_IPS', 'PERSISTENT_KEEPALIVE']) {
    out[f] = convergeField(renderModel.value, 'conns', id, f, extraRawOf(f))
  }
  return out
})

const form = reactive<ConnectionForm>({
  ENDPOINT: '', ALLOWED_IPS: [], ALLOWED_IPS_MODE: 'override', PERSISTENT_KEEPALIVE: '',
})

onMounted(() => {
  const f = cfgModel.value.getExtraForm()
  Object.assign(form, f)
  if (form.ALLOWED_IPS.length === 0) form.ALLOWED_IPS = ['']
})

const sharedGroups = computed(() => {
  const groups = model.value.getSharedGroups(props.edge.source, props.edge.target)
  return groups.map(name => ({
    name,
    virtual: model.value.isVirtualGroup(name),
    comment: model.value.getGroup(name)?.comment || '',
  })).sort((a, b) => (a.virtual === b.virtual ? 0 : a.virtual ? -1 : 1))
})

function handleSave() {
  emit('save', props.edge.source, props.edge.target, cfgModel.value.toConfPatch(form))
}
function handleReset() {
  emit('reset', props.edge.source, props.edge.target)
}
</script>
