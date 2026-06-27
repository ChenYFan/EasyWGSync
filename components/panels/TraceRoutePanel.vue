<template>
  <div class="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border shadow-xl z-50 flex flex-col">
    <div class="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
      <h3 class="text-sm font-medium text-foreground">Mock TraceRoute</h3>
      <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Source node -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Source</label>
        <MiniCard
          class="mt-1.5"
          type="node"
          :name="model.getNodeName(sourceId)"
          :pubkey="sourceId"
          :ipv4="model.getRealIPv4(sourceId)"
          full
        />
      </div>

      <!-- Target IP input -->
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Target IP</label>
        <div class="flex gap-2 mt-1">
          <input
            v-model="targetIp"
            class="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="e.g. 192.168.222.1"
            @keydown.enter="runTrace"
          />
          <button
            @click="runTrace"
            :disabled="tracing"
            class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
          >{{ tracing ? '...' : 'Trace' }}</button>
        </div>
      </div>

      <!-- Results -->
      <div v-if="result">
        <!-- Conclusion summary at top -->
        <div
          class="px-3 py-2 rounded-md border"
          :class="conclusionClass"
        >
          <p class="text-xs" :class="conclusionTextClass">
            <span class="font-medium">结论：</span>
            去程 {{ result.forward.error ? '不通' : '可达' }}（{{ result.forward.hops.length }} 跳）·
            回程 {{ returnStatus }}
          </p>
        </div>

        <!-- Forward: source -> target IP -->
        <div>
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">
            去程 ({{ result.forward.hops.length }} 跳)
          </label>
          <div class="mt-2 space-y-0">
            <template v-for="(hop, i) in result.forward.hops" :key="'f'+i">
              <MiniCard
                type="node"
                :name="hop.nodeName"
                :pubkey="hop.nodeId"
                :comment="hop.matchedCIDR ? `via ${hop.matchedCIDR}` : (hop.isSource ? 'Source' : hop.isDestination ? 'Destination' : '')"
                :ipv4="model.getRealIPv4(hop.nodeId)"
                :virtual="model.isCenter(hop.nodeId)"
                full
                @click="$emit('select-node', hop.nodeId)"
              />
              <div v-if="i < result.forward.hops.length - 1" class="text-center text-lg text-muted-foreground py-1">↓</div>
            </template>
          </div>
          <div v-if="result.forward.error" class="mt-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30">
            <p class="text-xs text-destructive">✗ {{ result.forward.error }}</p>
          </div>
        </div>

        <!-- Return: trace source IP FROM the destination node (always run, independent of forward) -->
        <div v-if="result.returnTrace" class="pt-4 border-t border-border">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">
            回程 ({{ result.returnTrace.hops.length }} 跳)
          </label>
          <div v-if="result.returnTrace" class="mt-2 space-y-0">
            <template v-for="(hop, i) in result.returnTrace.hops" :key="'r'+i">
              <MiniCard
                type="node"
                :name="hop.nodeName"
                :pubkey="hop.nodeId"
                :comment="hop.matchedCIDR ? `via ${hop.matchedCIDR}` : (hop.isSource ? 'Destination' : hop.isDestination ? 'Source' : '')"
                :ipv4="model.getRealIPv4(hop.nodeId)"
                :virtual="model.isCenter(hop.nodeId)"
                full
                @click="$emit('select-node', hop.nodeId)"
              />
              <div v-if="i < result.returnTrace!.hops.length - 1" class="text-center text-lg text-muted-foreground py-1">↓</div>
            </template>
          </div>
          <div v-if="result.returnTrace?.error" class="mt-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30">
            <p class="text-xs text-destructive">✗ {{ result.returnTrace.error }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'
import { parseWireGuardConfig, ipv4InCIDR, getCIDRPrefix, type ParsedWireGuardConfig } from '~/composables/useWgConfigParser'
import { useDraft } from '~/composables/useDraft'
import { authFetch } from '~/composables/useAuth'

const props = defineProps<{
  sourceId: string
  graphData: any
}>()

const emit = defineEmits<{
  close: []
  'select-node': [nodeId: string]
  'trace-result': [hops: { nodeId: string }[]]
}>()

const draftStore = useDraft()
const model = computed(() => new EasyWGSyncModel(props.graphData))
const targetIp = ref('')
const tracing = ref(false)
const result = ref<{
  forward: { hops: any[]; error?: string }
  returnTrace: { hops: any[]; error?: string } | null
  symmetric: boolean
} | null>(null)

// Fetch a node's generated WireGuard config (from draft) and parse it.
async function fetchNodeConfig(nodeId: string): Promise<ParsedWireGuardConfig | null> {
  const node = props.graphData?.nodes?.find((n: any) => n.id === nodeId)
  const peerName = node?.data?.fileName
  if (!peerName) return null
  try {
    const res = await authFetch('/api/admin/mock-config', {
      method: 'POST',
      body: { config: draftStore.draft.value, peerName },
    }) as any
    return parseWireGuardConfig(res.config)
  } catch {
    return null
  }
}

// Find node by IP (from graphData addresses)
function findNodeByIp(ip: string): string | null {
  const bare = ip.replace(/\/\d+$/, '')
  for (const n of props.graphData?.nodes || []) {
    const addr = n.data?.address || ''
    for (const a of addr.split(',').map((s: string) => s.trim())) {
      if (a.includes('.') && a.replace(/\/\d+$/, '') === bare) return n.id
    }
  }
  return null
}

// Trace using real generated configs: at each hop, fetch the node's .conf,
// look up which peer's AllowedIPs covers the target IP (longest prefix), go there.
async function traceWithRealConfig(
  sourceId: string,
  targetIp: string,
  maxHops = 16
): Promise<{ hops: any[]; error?: string }> {
  const hops: any[] = []
  const visited = new Set<string>()
  let currentId = sourceId
  const nodeName = (id: string) => props.graphData?.nodes?.find((n: any) => n.id === id)?.data?.fileName || id.slice(0, 12)

  hops.push({ nodeId: currentId, nodeName: nodeName(currentId), matchedCIDR: null, isSource: true, isDestination: false })

  for (let i = 0; i < maxHops; i++) {
    const conf = await fetchNodeConfig(currentId)
    if (!conf) {
      return { hops, error: `无法生成 ${nodeName(currentId)} 的配置` }
    }

    // Check if current node owns the target IP
    for (const ip of conf.ownIPs) {
      if (ip.includes('.') && ipv4InCIDR(targetIp, ip)) {
        hops[hops.length - 1].isDestination = true
        return { hops }
      }
    }

    if (visited.has(currentId)) {
      return { hops, error: `路由环路：${nodeName(currentId)} 被重复访问` }
    }
    visited.add(currentId)

    // Find best route: longest prefix match across all peers' AllowedIPs
    let bestPeer: { pubkey: string; cidr: string; prefix: number } | null = null
    for (const [pubkey, peer] of conf.peers) {
      for (const cidr of peer.allowedIPs) {
        if (!cidr.includes('.')) continue
        if (ipv4InCIDR(targetIp, cidr)) {
          const prefix = getCIDRPrefix(cidr)
          if (!bestPeer || prefix > bestPeer.prefix) {
            bestPeer = { pubkey, cidr, prefix }
          }
        }
      }
    }

    if (!bestPeer) {
      return { hops, error: `路由不可达：${nodeName(currentId)} 没有覆盖 ${targetIp} 的路由` }
    }

    // Map pubkey back to node id
    const nextNode = props.graphData?.nodes?.find((n: any) => n.data?.publicKey === bestPeer!.pubkey)
    if (!nextNode) {
      return { hops, error: `找不到 pubkey ${bestPeer.pubkey.slice(0, 8)} 对应的节点` }
    }

    currentId = nextNode.id
    hops.push({
      nodeId: currentId,
      nodeName: nodeName(currentId),
      matchedCIDR: bestPeer.cidr,
      isSource: false,
      isDestination: false,
    })
  }

  return { hops, error: `超过最大跳数 (${maxHops})` }
}

async function runTrace() {
  if (!targetIp.value.trim() || tracing.value) return
  tracing.value = true
  const ip = targetIp.value.trim()

  try {
    // 去程: source -> target IP
    const forward = await traceWithRealConfig(props.sourceId, ip)

    // 回程: 在目标节点上，对源节点 IP 做 trace
    let returnTrace: { hops: any[]; error?: string } | null = null
    let symmetric = false

    const srcNode = props.graphData?.nodes?.find((n: any) => n.id === props.sourceId)
    const srcAddr = srcNode?.data?.address || ''
    const srcIpv4 = srcAddr.split(',').map((s: string) => s.trim()).find((s: string) => s.includes('.'))?.replace(/\/\d+$/, '')
    const destId = findNodeByIp(ip)

    if (srcIpv4 && destId) {
      returnTrace = await traceWithRealConfig(destId, srcIpv4)
      if (!returnTrace.error && !forward.error) {
        const fwdIds = forward.hops.map(h => h.nodeId).reverse()
        const retIds = returnTrace.hops.map(h => h.nodeId)
        symmetric = JSON.stringify(fwdIds) === JSON.stringify(retIds)
      }
    } else if (!srcIpv4) {
      returnTrace = { hops: [], error: '无法验证回程：源节点无 IPv4 地址' }
    } else if (!destId) {
      returnTrace = { hops: [], error: '无法验证回程：找不到拥有该目标 IP 的节点' }
    }

    result.value = { forward, returnTrace, symmetric }
    if (result.value) {
      emit('trace-result', result.value.forward.hops)
    }
  } finally {
    tracing.value = false
  }
}

// Conclusion summary
const returnStatus = computed(() => {
  if (!result.value?.returnTrace) return '未测'
  if (result.value.returnTrace.error) return '不通'
  if (!result.value.symmetric) return '可达（非对称）'
  return '可达（对称）'
})

const bothOk = computed(() =>
  result.value && !result.value.forward.error &&
  result.value.returnTrace && !result.value.returnTrace.error
)
const conclusionClass = computed(() => {
  if (!result.value) return ''
  const fwdOk = !result.value.forward.error
  const retOk = result.value.returnTrace && !result.value.returnTrace.error
  if (fwdOk && retOk && result.value.symmetric) {
    return 'bg-emerald-500/10 border-emerald-500/30'
  }
  if (fwdOk && retOk && !result.value.symmetric) {
    return 'bg-yellow-500/10 border-yellow-500/30'
  }
  return 'bg-destructive/10 border-destructive/30'
})
const conclusionTextClass = computed(() => {
  if (!bothOk.value) return 'text-destructive'
  if (result.value?.symmetric) return 'text-emerald-400'
  return 'text-yellow-400'
})
</script>
