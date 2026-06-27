<template>
  <ModalShell
    :visible="visible"
    :z="200"
    width="90vw"
    max-width="920px"
    card-class="h-[85vh]"
    header-class="h-14 px-6"
    @close="$emit('close')"
  >
    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <h3 class="text-sm font-medium text-foreground shrink-0">完整配置</h3>
        <span class="text-[11px] font-mono text-muted-foreground truncate">{{ peerName }}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0 ml-auto">
        <div class="flex rounded-md border border-border overflow-hidden">
          <button
            v-for="f in (['conf', 'json'] as const)"
            :key="f"
            @click="format = f"
            class="px-2.5 h-7 text-[11px] font-medium transition-colors"
            :class="format === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
          >{{ f.toUpperCase() }}</button>
        </div>
        <button @click="copy" class="h-7 px-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          {{ copied ? '已复制' : '复制' }}
        </button>
        <button @click="openUrl" :disabled="!pullUrl" :title="pullUrl" class="h-7 px-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
          打开 URL ↗
        </button>
      </div>
    </template>

    <div class="flex-1 overflow-auto p-0 bg-background/40">
      <div v-if="loading" class="p-8 text-center text-sm text-muted-foreground">生成中…</div>
      <div v-else-if="error" class="p-8 text-center text-sm text-error">{{ error }}</div>
      <pre v-else class="text-[11px] font-mono leading-relaxed p-4 text-foreground whitespace-pre">{{ rendered }}</pre>
    </div>
  </ModalShell>
</template>

<script setup lang="ts">
import { useDraft } from '~/composables/useDraft'
import { authFetch } from '~/composables/useAuth'

const props = defineProps<{
  visible: boolean
  peerName: string
}>()

defineEmits<{ close: [] }>()

const draftStore = useDraft()

const format = ref<'conf' | 'json'>('conf')
const loading = ref(false)
const error = ref('')
const confText = ref('')
const copied = ref(false)
const pullSecret = ref('')

// Fetch the client-pull secret once (admin-only) to build the "open URL" link.
async function loadSecret() {
  if (pullSecret.value) return
  try {
    const res = await authFetch('/api/admin/secret') as { secret?: string }
    pullSecret.value = res?.secret || ''
  } catch { /* leave empty — button stays disabled */ }
}

// The peer-pull URL: /api/getPeerConfig?secret=<secret>&peername=<peerName>
const pullUrl = computed(() => {
  if (!pullSecret.value || !props.peerName) return ''
  const q = new URLSearchParams({ secret: pullSecret.value, peername: props.peerName })
  return `/api/getPeerConfig?${q.toString()}`
})

function openUrl() {
  const url = pullUrl.value
  if (!url) return
  window.open(url, '_blank', 'noopener')
}

// Fetch the real, complete generated .conf for this peer from the current draft.
async function load() {
  if (!props.peerName) {
    error.value = '无法确定节点文件名'
    return
  }
  loading.value = true
  error.value = ''
  confText.value = ''
  try {
    const res = await authFetch('/api/admin/mock-config', {
      method: 'POST',
      body: { config: draftStore.draft.value, peerName: props.peerName },
    }) as { config: string }
    confText.value = res.config || ''
  } catch (e: any) {
    error.value = e?.data?.error || e?.message || '生成失败'
  } finally {
    loading.value = false
  }
}

watch(() => [props.visible, props.peerName], ([vis]) => {
  if (vis) {
    load()
    loadSecret()
  }
})

// --- generic .conf → ordered sections (preserve every key/value) ---
const MULTI_KEYS = new Set(['Address', 'AllowedIPs', 'DNS'])
interface Section { type: string; fields: Array<[string, string]> }

const sections = computed<Section[]>(() => {
  const out: Section[] = []
  let cur: Section | null = null
  for (const raw of confText.value.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      cur = { type: sec[1], fields: [] }
      out.push(cur)
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1 || !cur) continue
    cur.fields.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()])
  }
  return out
})

// Convert a section's fields into a plain object (split multi-value keys to arrays).
function sectionObj(s: Section): Record<string, string | string[]> {
  const o: Record<string, string | string[]> = {}
  for (const [k, v] of s.fields) {
    o[k] = MULTI_KEYS.has(k) ? v.split(',').map(x => x.trim()).filter(Boolean) : v
  }
  return o
}

const asJson = computed(() => {
  const iface = sections.value.find(s => s.type === 'Interface')
  const peers = sections.value.filter(s => s.type === 'Peer')
  return JSON.stringify(
    {
      Interface: iface ? sectionObj(iface) : {},
      Peers: peers.map(sectionObj),
    },
    null,
    2,
  )
})

const rendered = computed(() =>
  format.value === 'json' ? asJson.value : confText.value
)

async function copy() {
  try {
    await navigator.clipboard.writeText(rendered.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* clipboard blocked — ignore */ }
}
</script>
