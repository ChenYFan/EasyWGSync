<template>
  <SidePanel title="Mock TraceRoute" @close="$emit('close')">
      <div>
        <label class="field-label">Source</label>
        <MiniCard
          class="mt-1.5"
          type="node"
          :name="model.getNodeName(sourceId)"
          :pubkey="sourceId"
          :ipv4="model.getRealIPv4(sourceId)"
          full
        />
      </div>

      <div>
        <label class="field-label">Target IP</label>
        <div class="flex gap-2 mt-1">
          <input
            v-model="targetIp"
            class="flex-1 field-input font-mono"
            placeholder="e.g. 127.0.0.1"
            @keydown.enter="runTrace"
          />
          <button
            @click="runTrace"
            :disabled="tracing"
            class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
          >{{ tracing ? '...' : 'Trace' }}</button>
        </div>
      </div>

      <div v-if="result">
        <StatusBox :level="conclusionLevel">
          <p class="text-xs" :class="conclusionTextClass">
            <span class="font-medium">结论：</span>
            去程 {{ result.forward.error ? '不通' : '可达' }} ·
            回程 {{ returnStatus }}
          </p>
        </StatusBox>

        <!-- Forward: source -> target IP -->
        <div>
          <label class="field-label">
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
          <StatusBox v-if="result.forward.error" level="error" class="mt-2">
            <p class="text-xs text-error">✗ {{ result.forward.error }}</p>
          </StatusBox>
        </div>

        <!-- Return: trace source IP FROM the destination node (always run, independent of forward) -->
        <div v-if="result.returnTrace" class="pt-4 border-t border-border">
          <label class="field-label">
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
          <StatusBox v-if="result.returnTrace?.error" level="error" class="mt-2">
            <p class="text-xs text-error">✗ {{ result.returnTrace.error }}</p>
          </StatusBox>
        </div>
      </div>
  </SidePanel>
</template>

<script setup lang="ts">
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'
import { tracePath, centerRoutingConfig, extractIP, extractCenterOwnIPs, buildPubkeyToId, type ParsedWireGuardConfig } from '~/composables/useWgConfigParser'
import { fetchParsedConfig } from '~/composables/useHealthFull'
import { useDraft } from '~/composables/useDraft'

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
  // CENTER has no peer .conf to generate — use its real routing table (a [Peer]
  // per node /32; ownIPs read off the CENTER node) so a trace through OR to the
  // hub resolves instead of dead-ending.
  if (node?.data?.isCenter) return centerRoutingConfig(props.graphData?.nodes || [])
  const peerName = node?.data?.fileName
  if (!peerName) return null
  return fetchParsedConfig(peerName, draftStore.draft.value)
}

// Find node by IP (from graphData addresses; CENTER via its stamped ownIPs,
// since its display address is the 'ALL' sentinel).
function findNodeByIp(ip: string): string | null {
  const bare = ip.replace(/\/\d+$/, '')
  for (const n of props.graphData?.nodes || []) {
    const addrs = [n.data?.address || '', ...(n.data?.ownIPs || [])].join(',')
    for (const a of addrs.split(',').map((s: string) => s.trim())) {
      if (a.replace(/\/\d+$/, '') === bare) return n.id
    }
  }
  return null
}

// tracePath drives the hop-by-hop logic (routeStep + CENTER-NAT source rewrite
// + cryptokey source-acceptance) and is shared with health. TraceRoutePanel
// feeds it a per-node async getter (fetchNodeConfig — fetches on demand) and
// decorates the returned hops for display. pubkeyToId + CENTER own-IP
// extraction reuse the shared helpers from useWgConfigParser.

// Decorate tracePath's plain hops { nodeId, cidr } into the display shape the
// template expects (nodeName, matchedCIDR, isSource, isDestination).
function decorateHops(hops: { nodeId: string; cidr: string | null }[]): any[] {
  return hops.map((h, i) => ({
    nodeId: h.nodeId,
    nodeName: model.value.getNodeName(h.nodeId),
    matchedCIDR: h.cidr,
    isSource: i === 0,
    isDestination: i === hops.length - 1,
  }))
}

async function runTrace() {
  if (!targetIp.value.trim() || tracing.value) return
  tracing.value = true
  const ip = targetIp.value.trim()

  try {
    const isV6 = ip.includes(':')
    const family = isV6 ? 'v6' : 'v4'
    const srcNode = props.graphData?.nodes?.find((n: any) => n.id === props.sourceId)
    const srcIp = extractIP(srcNode?.data?.address || '', family)
    const destId = findNodeByIp(ip)
    const destNode = destId ? props.graphData?.nodes?.find((n: any) => n.id === destId) : null
    const destIp = extractIP(destNode?.data?.address || '', family)

    // tracePath is async + takes a per-node config getter; fetchNodeConfig
    // fetches each hop's .conf on demand (CENTER via its synthetic table).
    const pubkeyToId = buildPubkeyToId(props.graphData?.nodes || [])
    const centerNode = props.graphData?.nodes?.find((n: any) => n.data?.isCenter)
    const centerId = centerNode?.id
    const centerOwn = extractCenterOwnIPs(centerNode?.data?.ownIPs)
    const centerOwnV4 = centerOwn.v4 || undefined
    const centerOwnV6 = centerOwn.v6 || undefined

    // 去程: source -> target IP (source IP = srcIp, same family)
    const fwd = await tracePath({ sourceId: props.sourceId, targetIp: ip, getConfig: fetchNodeConfig, pubkeyToId, centerId, centerOwnIpV4: centerOwnV4, centerOwnIpV6: centerOwnV6, sourceIp: srcIp || '' })
    const forward = { hops: decorateHops(fwd.hops), error: fwd.ok ? undefined : fwd.reason }

    // 回程: dest -> src IP (source IP = destIp, same family)
    let returnTrace: { hops: any[]; error?: string } | null = null
    let symmetric = false

    if (srcIp && destId && destIp) {
      const ret = await tracePath({ sourceId: destId, targetIp: srcIp, getConfig: fetchNodeConfig, pubkeyToId, centerId, centerOwnIpV4: centerOwnV4, centerOwnIpV6: centerOwnV6, sourceIp: destIp })
      returnTrace = { hops: decorateHops(ret.hops), error: ret.ok ? undefined : ret.reason }
      if (!returnTrace.error && !forward.error) {
        const fwdIds = forward.hops.map((h: any) => h.nodeId).reverse()
        const retIds = returnTrace.hops.map((h: any) => h.nodeId)
        symmetric = JSON.stringify(fwdIds) === JSON.stringify(retIds)
      }
    } else if (!srcIp) {
      returnTrace = { hops: [], error: `无法验证回程：源节点无 ${isV6 ? 'IPv6' : 'IPv4'} 地址` }
    } else if (!destId) {
      returnTrace = { hops: [], error: '无法验证回程：找不到拥有该目标 IP 的节点' }
    } else if (!destIp) {
      returnTrace = { hops: [], error: `无法验证回程：目标节点无 ${isV6 ? 'IPv6' : 'IPv4'} 地址` }
    }

    result.value = { forward, returnTrace, symmetric }
    if (result.value) {
      emit('trace-result', result.value.forward.hops)
    }
  } finally {
    tracing.value = false
  }
}

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
const conclusionLevel = computed<'success' | 'warning' | 'error'>(() => {
  if (!result.value) return 'error'
  const fwdOk = !result.value.forward.error
  const retOk = result.value.returnTrace && !result.value.returnTrace.error
  if (fwdOk && retOk && result.value.symmetric) return 'success'
  if (fwdOk && retOk && !result.value.symmetric) return 'warning'
  return 'error'
})
const conclusionTextClass = computed(() => {
  if (!bothOk.value) return 'text-error'
  if (result.value?.symmetric) return 'text-success'
  return 'text-warning'
})
</script>
