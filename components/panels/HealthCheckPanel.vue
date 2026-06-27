<template>
  <SidePanel title="Health Check" @close="$emit('close')">
      <StatusBox :level="summaryLevel">
        <p class="text-xs font-medium" :class="summaryTextClass">{{ summaryText }}</p>
      </StatusBox>

      <div>
        <label class="field-label font-semibold">快速检查</label>
        <p class="text-[11px] text-muted-foreground mt-1">校验高级抽象声明与连接语义</p>
      </div>

      <div v-if="quick.gatewayUniqueness.length">
        <label class="text-[10px] uppercase tracking-wider text-error font-semibold">
          Gateway 唯一性违反 ({{ quick.gatewayUniqueness.length }})
        </label>
        <p class="text-[11px] text-muted-foreground mt-1 mb-2">
          一个节点活跃的 Gateway 只能有一个。
        </p>
        <div class="space-y-2">
          <NodeFinding
            v-for="(g, i) in quick.gatewayUniqueness"
            :key="'gu'+i"
            level="error"
            :title="g.name"
            :sub="`有 ${g.exits.length} 个 Gateway`"
            :nodes="g.exits"
            @select="$emit('select-node', $event)"
          />
        </div>
      </div>

      <div v-if="quick.relayUniqueness.length">
        <label class="text-[10px] uppercase tracking-wider text-error font-semibold">
          Relay 唯一性违反 ({{ quick.relayUniqueness.length }})
        </label>
        <p class="text-[11px] text-muted-foreground mt-1 mb-2">
          一个节点只能被一个节点 Relay。
        </p>
        <div class="space-y-2">
          <NodeFinding
            v-for="(r, i) in quick.relayUniqueness"
            :key="'ru'+i"
            level="error"
            :title="r.name"
            :sub="`被 ${r.relayers.length} 个节点 Relay`"
            :nodes="r.relayers"
            @select="$emit('select-node', $event)"
          />
        </div>
      </div>

      <!-- Connection missing — ERROR (no relationship at all) -->
      <div v-if="quick.connectionErrors.length">
        <label class="text-[10px] uppercase tracking-wider text-error font-semibold">
          声明缺少底层连接 ({{ quick.connectionErrors.length }})
        </label>
        <p class="text-[11px] text-muted-foreground mt-1 mb-2">
          声明的两端无任何连接关系，不在同一 Mesh 组、也无手动 P2P，无法生效。
        </p>
        <div class="space-y-2">
          <StatusBox v-for="(m, i) in quick.connectionErrors" :key="'ce'+i" level="error">
            <div class="flex items-center gap-2">
              <StatusChip level="error" solid>{{ m.kind }}</StatusChip>
              <span class="text-xs text-foreground">{{ m.aName }}</span>
              <span class="text-[10px] text-muted-foreground">↔</span>
              <span class="text-xs text-foreground">{{ m.bName }}</span>
            </div>
          </StatusBox>
        </div>
      </div>

      <!-- Connection disabled — WARNING (only disabled group) -->
      <div v-if="quick.connectionWarnings.length">
        <label class="text-[10px] uppercase tracking-wider text-warning font-semibold">
          声明连接已禁用 ({{ quick.connectionWarnings.length }})
        </label>
        <p class="text-[11px] text-muted-foreground mt-1 mb-2">
          声明的两端仅在已禁用的组中，启用该组后生效。
        </p>
        <div class="space-y-2">
          <StatusBox v-for="(m, i) in quick.connectionWarnings" :key="'cw'+i" level="warning">
            <div class="flex items-center gap-2">
              <StatusChip level="warning" solid>{{ m.kind }}</StatusChip>
              <span class="text-xs text-foreground">{{ m.aName }}</span>
              <span class="text-[10px] text-muted-foreground">↔</span>
              <span class="text-xs text-foreground">{{ m.bName }}</span>
            </div>
          </StatusBox>
        </div>
      </div>

      <div class="pt-2 border-t border-border">
        <div class="flex items-center justify-between">
          <div>
            <label class="field-label font-semibold">完整检查</label>
            <p class="text-[11px] text-muted-foreground mt-1">渲染真实配置，检查 AllowedIPs 重复 + 全节点单向可达。</p>
          </div>
        </div>
        <button
          @click="runFull"
          :disabled="fullLoading"
          class="mt-2 w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
        >{{ fullLoading ? '检查中…' : (fullDone ? '重新运行完整检查' : '运行完整检查') }}</button>
      </div>

      <template v-if="fullDone && !fullLoading">
        <StatusBox v-if="full.failed.length" level="warning">
          <p class="text-xs text-warning">{{ full.failed.length }} 个节点配置生成失败，已跳过：{{ full.failed.map(f => f.name).join('、') }}</p>
        </StatusBox>

        <!-- AllowedIPs exact duplicates (error) -->
        <div v-if="full.duplicates.length">
          <label class="text-[10px] uppercase tracking-wider text-error font-semibold">
            AllowedIPs 重复声明 ({{ full.duplicates.length }})
          </label>
          <p class="text-[11px] text-muted-foreground mt-1 mb-2">
            同一节点内多个 [Peer] 声明了完全相同的 AllowedIPs，逐字相同、覆盖不算，WireGuard 无法决定路由归属。
          </p>
          <div class="space-y-2">
            <NodeFinding v-for="(d, i) in full.duplicates" :key="'dup'+i" level="error" :title="d.nodeName" :nodes="d.peers" @select="$emit('select-node', $event)">
              <template #sub>可达 <span class="font-mono text-error font-semibold">{{ d.ip }}</span> 的有 {{ d.peers.length }} 个节点</template>
            </NodeFinding>
          </div>
        </div>

        <!-- One-way unreachable pairs (error), grouped by source -->
        <div v-if="unreachableBySource.length">
          <label class="text-[10px] uppercase tracking-wider text-error font-semibold">
            单向不可达 ({{ full.unreachable.length }})
          </label>
          <p class="text-[11px] text-muted-foreground mt-1 mb-2">
            按各节点实际路由表模拟，下列源节点无法路由到目标节点。
          </p>
          <div class="space-y-2">
            <NodeFinding
              v-for="grp in unreachableBySource"
              :key="grp.src"
              level="error"
              :title="grp.srcName"
              :sub="`不可达下列 ${grp.targets.length} 个节点`"
              :nodes="grp.targets"
              @select="$emit('select-node', $event)"
            />
          </div>
        </div>

        <StatusBox v-if="!full.duplicates.length && !full.unreachable.length" level="success">
          <p class="text-xs text-success">✓ 实际路由检查通过：无重复 AllowedIPs，全节点可达。</p>
        </StatusBox>
      </template>
  </SidePanel>
</template>

<script setup lang="ts">
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'
import { runFullHealthCheck, type FullHealthResult } from '~/composables/useHealthFull'

const props = defineProps<{
  graphData: any
}>()

defineEmits<{
  close: []
  'select-node': [nodeId: string]
}>()

const model = computed(() => new EasyWGSyncModel(props.graphData))
const quick = computed(() => model.value.quickCheck())

// Severity split: errors (red) vs warnings (amber) — quick checks only.
const errorCount = computed(() =>
  quick.value.gatewayUniqueness.length +
  quick.value.relayUniqueness.length +
  quick.value.connectionErrors.length
)
const warningCount = computed(() => quick.value.connectionWarnings.length)

const summaryLevel = computed<'error' | 'warning' | 'success'>(() => {
  if (errorCount.value > 0) return 'error'
  if (warningCount.value > 0) return 'warning'
  return 'success'
})
const summaryTextClass = computed(() => {
  if (errorCount.value > 0) return 'text-error'
  if (warningCount.value > 0) return 'text-warning'
  return 'text-success'
})
const summaryText = computed(() => {
  if (errorCount.value > 0) {
    return warningCount.value > 0
      ? `发现 ${errorCount.value} 个问题，${warningCount.value} 个警告`
      : `发现 ${errorCount.value} 个问题`
  }
  if (warningCount.value > 0) return `${warningCount.value} 个警告`
  return '✓ 抽象层检查正常'
})

// --- Full (dynamic) check ---
const fullLoading = ref(false)
const fullDone = ref(false)
const full = ref<FullHealthResult>({ duplicates: [], unreachable: [], failed: [] })

async function runFull() {
  if (fullLoading.value) return
  fullLoading.value = true
  try {
    full.value = await runFullHealthCheck(props.graphData)
    fullDone.value = true
  } finally {
    fullLoading.value = false
  }
}

const unreachableBySource = computed(() => {
  const bySrc = new Map<string, { src: string; srcName: string; targets: Array<{ id: string; name: string }> }>()
  for (const u of full.value.unreachable) {
    if (!bySrc.has(u.src)) bySrc.set(u.src, { src: u.src, srcName: u.srcName, targets: [] })
    bySrc.get(u.src)!.targets.push({ id: u.tgt, name: u.tgtName })
  }
  return [...bySrc.values()]
})
</script>
