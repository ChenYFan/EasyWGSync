<template>
  <SidePanel title="Edit Peer" body-class="p-4 space-y-3" @close="$emit('close')">
      <div class="space-y-3 pb-3 border-b border-border">
        <div>
          <label class="field-label">Real Name</label>
          <p class="text-sm text-foreground mt-1">{{ model.getNodeName(pubkey) }}</p>
        </div>
        <div>
          <label class="field-label">Public Key</label>
          <p class="text-xs font-mono text-foreground mt-1 break-all select-all bg-background rounded px-2 py-1.5 border border-input">{{ pubkey }}</p>
        </div>
        <div>
          <label class="field-label">Comment</label>
          <input v-model="form.COMMENTS" class="mt-1 w-full field-input" placeholder="备注" />
        </div>
        <div v-if="sortedGroups.length">
          <label class="field-label">Groups</label>
          <CardGrid class="mt-1.5">
            <MiniCard v-for="group in sortedGroups" :key="group.name" type="group" :name="group.name" :color="getGroupColor(group.name)" :virtual="group.virtual" :full="group.virtual" :comment="group.comment" :count="group.count" @click="$emit('select-group', group.name)" />
          </CardGrid>
        </div>
        <div v-if="directPeers.length">
          <label class="field-label">Direct Connections</label>
          <CardGrid class="mt-1.5">
            <MiniCard v-for="peer in directPeers" :key="peer.id" type="node" :name="peer.name" :comment="peer.comment" :ipv4="peer.ipv4" :virtual="peer.isVirtual" :full="peer.isVirtual" @click="$emit('select-node', peer.id)" />
          </CardGrid>
        </div>
      </div>

      <CollapsibleSection title="Network" open>
          <div>
            <label class="field-label">Endpoint</label>
            <input v-model="form.ENDPOINT" class="mt-1 w-full field-input font-mono" :placeholder="placeholders.endpoint" />
          </div>
          <div>
            <label class="field-label">DNS</label>
            <input v-model="form.DNS" class="mt-1 w-full field-input font-mono" :placeholder="placeholders.dns" />
          </div>
          <div>
            <label class="field-label">Listen Port</label>
            <input v-model="form.LISTEN_PORT" class="mt-1 w-full field-input font-mono" :placeholder="placeholders.listenPort" />
          </div>
          <!-- ALLOWED_IPS with append/override toggle -->
          <div>
            <div class="flex items-center justify-between">
              <label class="field-label">Allowed IPs</label>
              <ModeToggle v-model="form.ALLOWED_IPS_MODE" />
            </div>
            <div class="mt-1 space-y-1">
              <div v-for="(_ip, i) in form.ALLOWED_IPS" :key="i" class="flex gap-1">
                <input v-model="form.ALLOWED_IPS[i]" class="flex-1 h-8 px-2 rounded border border-input bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring" :placeholder="placeholders.allowedIp(i)" />
                <button @click="form.ALLOWED_IPS.splice(i, 1)" class="shrink-0 w-8 h-8 rounded-md border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center transition-colors text-base leading-none">&times;</button>
              </div>
              <button @click="form.ALLOWED_IPS.push('')" class="text-xs text-muted-foreground hover:text-foreground">+ Add IP</button>
            </div>
          </div>
      </CollapsibleSection>

      <CollapsibleSection title="Option" body-class="space-y-2">
          <div v-for="type in SCRIPT_TYPES" :key="type">
            <div class="flex items-center justify-between">
              <label class="text-[10px] text-muted-foreground">{{ type }}</label>
              <ModeToggle v-model="form.SCRIPTS_MODE[type]" />
            </div>
            <textarea v-model="form.SCRIPTS[type]" rows="2" class="mt-1 w-full field-textarea" :placeholder="placeholders.script(type)" />
          </div>
      </CollapsibleSection>

      <CollapsibleSection title="Final Config" open body-class="space-y-2">
        <template #title-extra>
          <button @click.stop.prevent="showFullConfig = true" class="normal-case tracking-normal text-[11px] text-primary hover:underline">查看完整配置 →</button>
        </template>
          <LayeredField label="Endpoint" :conv="layers.ENDPOINT" />
          <LayeredField label="DNS" :conv="layers.DNS" />
          <LayeredField label="Listen Port" :conv="layers.LISTEN_PORT" />
          <LayeredField label="Allowed IPs" :conv="layers.ALLOWED_IPS" wrap="comma" />
          <LayeredField v-for="t in SCRIPT_TYPES" :key="t" :label="t" :conv="layers[t]" wrap="semicolon" />
      </CollapsibleSection>

      <FullConfigModal :visible="showFullConfig" :peer-name="peerName" @close="showFullConfig = false" />


    <template #footer>
      <button @click="$emit('close')" class="btn-ghost">Cancel</button>
      <button @click="handleSave" class="btn-primary">Save</button>
    </template>
  </SidePanel>
</template>

<script setup lang="ts">
import { getGroupColor } from '~/composables/useMeshGraph'
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'
import { useDraft } from '~/composables/useDraft'
import { PeerConfigModel, type PeerForm } from '~/composables/useConfigModel'
import { convergeField } from '~/composables/useRenderModel'
import type { ScriptType } from '~/types'

const SCRIPT_TYPES: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

const props = defineProps<{
  pubkey: string
  config: any
  graphData: any
}>()

const emit = defineEmits<{
  close: []
  save: [pubkey: string, data: any]
  'select-node': [nodeId: string]
  'select-group': [groupName: string]
  'goto-hybrid': [payload: { pub: string }]
}>()

const model = computed(() => new EasyWGSyncModel(props.graphData))
const { draft, base, renderModel } = useDraft()

// Full WireGuard config viewer (this peer's complete generated .conf).
const showFullConfig = ref(false)
const peerName = computed(() => model.value.getNodeName(props.pubkey))

const defaultLayer = computed(() => base.value.basePeers.find(p => p.publicKey === props.pubkey)?.default)
const confLayer = computed(() => draft.value.EXTRA_CONFIG?.[props.pubkey])
const onlineEndpoint = computed(() => base.value.onlineEndpoints?.[props.pubkey])

// default layer = .conf + EasyWGSync GLOBAL_* (both are the first abstraction).
const modelCtx = computed(() => ({
  onlineEndpoint: onlineEndpoint.value,
  globalListenPort: draft.value.GLOBAL_LISTEN_PORT,
  globalDns: draft.value.GLOBAL_DNS,
  globalScripts: draft.value.GLOBAL_SCRIPTS,
}))

const cfgModel = computed(() =>
  new PeerConfigModel(defaultLayer.value, confLayer.value, modelCtx.value)
)

const placeholders = computed(() => cfgModel.value.getPlaceholders())

// Live preview: per field, splice the in-progress form value (extra layer) into
// the cached changelog from renderModel, then converge. default + declaration
// come from the single renderModel — zero re-render.
const PREVIEW_FIELDS = ['ENDPOINT', 'DNS', 'LISTEN_PORT', 'ALLOWED_IPS', 'PreUp', 'PostUp', 'PreDown', 'PostDown']
function extraRawOf(field: string): string {
  if (field === 'ENDPOINT') return form.ENDPOINT.trim()
  if (field === 'DNS') return form.DNS.trim()
  if (field === 'LISTEN_PORT') return form.LISTEN_PORT.trim()
  if (field === 'ALLOWED_IPS') {
    const items = form.ALLOWED_IPS.map(s => s.trim()).filter(Boolean)
    if (form.ALLOWED_IPS_MODE === 'append') return items.length ? `@ ${items.join(', ')}` : '@'
    return items.join(', ')
  }
  const t = field as ScriptType
  const txt = (form.SCRIPTS[t] || '').trim()
  if (form.SCRIPTS_MODE[t] === 'append') return txt ? `@ ${txt}` : '@'
  return txt
}
const layers = computed(() => {
  const out: Record<string, ReturnType<typeof convergeField>> = {}
  for (const f of PREVIEW_FIELDS) out[f] = convergeField(renderModel.value, 'peers', props.pubkey, f, extraRawOf(f))
  return out
})

const form = reactive<PeerForm>({
  COMMENTS: '', ENDPOINT: '', DNS: '', LISTEN_PORT: '',
  ALLOWED_IPS: [], ALLOWED_IPS_MODE: 'override',
  SCRIPTS: { PreUp: '', PostUp: '', PreDown: '', PostDown: '' },
  SCRIPTS_MODE: { PreUp: 'override', PostUp: 'override', PreDown: 'override', PostDown: 'override' },
})

// Seed the form from extraConf raw values (NOT overlaid with default — empty =未覆盖).
onMounted(() => {
  const f = cfgModel.value.getExtraForm()
  Object.assign(form, f)
  if (form.ALLOWED_IPS.length === 0) form.ALLOWED_IPS = ['']
})

const sortedGroups = computed(() => model.value.getSortedGroupsOf(props.pubkey))
const directPeers = computed(() => model.value.getDirectPeersInfo(props.pubkey))

function handleSave() {
  emit('save', props.pubkey, cfgModel.value.toConfPatch(form))
}
</script>
