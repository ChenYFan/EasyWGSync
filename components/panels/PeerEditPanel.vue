<template>
  <div class="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border shadow-xl z-50 flex flex-col">
    <div class="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
      <h3 class="text-sm font-medium text-foreground">Edit Peer</h3>
      <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- WGDashboard Name (readonly) -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Real Name</label>
        <p class="text-sm text-foreground mt-1">{{ model.getNodeName(pubkey) }}</p>
      </div>

      <!-- Public Key (full, readonly) -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Public Key</label>
        <p class="text-xs font-mono text-foreground mt-1 break-all select-all bg-background rounded px-2 py-1.5 border border-input">{{ pubkey }}</p>
      </div>

      <!-- Comment (editable) -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Comment</label>
        <input
          v-model="form.COMMENTS"
          class="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="备注"
        />
      </div>

      <!-- Groups -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Groups</label>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <MiniCard
            v-for="group in sortedGroups"
            :key="group.name"
            type="group"
            :name="group.name"
            :color="getGroupColor(group.name)"
            :virtual="group.virtual"
            :full="group.virtual"
            :comment="group.comment"
            :count="group.count"
            @click="$emit('select-group', group.name)"
          />
          <p v-if="!sortedGroups.length" class="text-xs text-muted-foreground">No groups</p>
        </div>
      </div>

      <!-- Direct Connections -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Direct Connections</label>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <MiniCard
            v-for="peer in directPeers"
            :key="peer.id"
            type="node"
            :name="peer.name"
            :comment="peer.comment"
            :ipv4="peer.ipv4"
            :virtual="peer.isVirtual"
            :full="peer.isVirtual"
            @click="$emit('select-node', peer.id)"
          />
          <p v-if="!directPeers.length" class="text-xs text-muted-foreground">No direct connections</p>
        </div>
      </div>

      <!-- Endpoint -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Endpoint</label>
        <input
          v-model="form.ENDPOINT"
          class="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          :placeholder="defaults.endpoint"
        />
      </div>

      <!-- DNS -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">DNS Override</label>
        <input
          v-model="form.DNS"
          class="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          :placeholder="defaults.dns"
        />
      </div>

      <!-- Scripts -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Scripts</label>
        <div class="mt-1 space-y-2">
          <div v-for="type in ['PreUp', 'PostUp', 'PreDown', 'PostDown']" :key="type">
            <label class="text-[10px] text-muted-foreground">{{ type }}</label>
            <textarea
              v-model="form.SCRIPTS[type]"
              rows="2"
              class="w-full px-2 py-1.5 rounded border border-input bg-background text-xs text-foreground font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              :placeholder="defaults.script(type)"
            />
          </div>
        </div>
      </div>

      <!-- ALLOWED_IPS -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Allowed IPs (global)</label>
        <div class="mt-1 space-y-1">
          <div v-for="(ip, i) in form.ALLOWED_IPS" :key="i" class="flex gap-1">
            <input
              v-model="form.ALLOWED_IPS[i]"
              class="flex-1 h-8 px-2 rounded border border-input bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              :placeholder="defaults.allowedIp(i)"
            />
            <button @click="removeAllowedIp(i)" class="shrink-0 w-8 h-8 rounded-md border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center transition-colors text-base leading-none">&times;</button>
          </div>
          <button
            @click="form.ALLOWED_IPS.push('')"
            class="text-xs text-muted-foreground hover:text-foreground"
          >+ Add IP</button>
        </div>
      </div>
    </div>

    <div class="h-14 flex items-center justify-end gap-2 px-4 border-t border-border shrink-0">
      <button
        @click="$emit('close')"
        class="h-8 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >Cancel</button>
      <button
        @click="handleSave"
        class="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
      >Save</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getGroupColor } from '~/composables/useMeshGraph'
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'
import { useDraft } from '~/composables/useDraft'

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
}>()

const model = computed(() => new EasyWGSyncModel(props.graphData))

const ownNode = computed(() => props.graphData?.nodes?.find((n: any) => n.id === props.pubkey)?.data)
const globalConfig = computed(() => props.graphData?.globalConfig || {})
const ownIPs = computed(() => {
  const addr = ownNode.value?.address || ''
  return addr.split(',').map((s: string) => s.trim()).filter(Boolean)
})

// Placeholder defaults: empty field = inherited. Show the effective default
// value directly (no "默认" prefix) — node's own value first, then global.
const defaults = computed(() => {
  const node = ownNode.value
  const g = globalConfig.value as any
  const ips = ownIPs.value
  return {
    endpoint: node?.endpoint && node.endpoint !== 'none'
      ? node.endpoint
      : '自动发现',
    dns: g.GLOBAL_DNS ? '全局 DNS' : '无',
    script: (type: string) => {
      const gv = (g.GLOBAL_SCRIPTS || {})[type]
      return gv || '无'
    },
    allowedIp: (i: number) =>
      ips[i] || '节点自身 IP',
  }
})

const form = reactive({
  COMMENTS: props.config?.comments || '',
  ENDPOINT: props.config?.endpoint || '',
  DNS: props.config?.dns || '',
  SCRIPTS: {
    PreUp: '',
    PostUp: '',
    PreDown: '',
    PostDown: '',
  } as Record<string, string>,
  ALLOWED_IPS: [] as string[],
})

// Read full EXTRA_CONFIG for this peer from the draft (no backend round-trip)
const { draft } = useDraft()
onMounted(() => {
  const full = draft.value.EXTRA_CONFIG[props.pubkey]
  if (full) {
    if (full.COMMENTS) form.COMMENTS = full.COMMENTS
    if (full.ENDPOINT) form.ENDPOINT = full.ENDPOINT
    if (full.DNS) form.DNS = full.DNS
    if (full.SCRIPTS) {
      for (const key of Object.keys(full.SCRIPTS)) {
        form.SCRIPTS[key] = (full.SCRIPTS as Record<string, string>)[key]
      }
    }
    if (full.ALLOWED_IPS && full.ALLOWED_IPS.length) form.ALLOWED_IPS = [...full.ALLOWED_IPS]
  }
  // Empty ALLOWED_IPS = default. Render two empty slots so the placeholders
  // (node's own IPs) show what the default actually resolves to.
  if (form.ALLOWED_IPS.length === 0) {
    form.ALLOWED_IPS = ['', '']
  }
})

function removeAllowedIp(i: number) {
  form.ALLOWED_IPS.splice(i, 1)
}

const sortedGroups = computed(() => model.value.getSortedGroupsOf(props.pubkey))
const directPeers = computed(() => model.value.getDirectPeersInfo(props.pubkey))

function handleSave() {
  const data: any = {}
  if (form.COMMENTS) data.COMMENTS = form.COMMENTS
  if (form.ENDPOINT) data.ENDPOINT = form.ENDPOINT
  if (form.DNS) data.DNS = form.DNS
  const scripts = Object.fromEntries(Object.entries(form.SCRIPTS).filter(([_, v]) => v.trim()))
  if (Object.keys(scripts).length > 0) data.SCRIPTS = scripts
  const ips = form.ALLOWED_IPS.filter(ip => ip.trim())
  if (ips.length > 0) data.ALLOWED_IPS = ips
  emit('save', props.pubkey, data)
}
</script>
