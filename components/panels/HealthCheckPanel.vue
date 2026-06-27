<template>
  <div class="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border shadow-xl z-50 flex flex-col">
    <div class="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
      <h3 class="text-sm font-medium text-foreground">配置健康检查</h3>
      <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Summary -->
      <div class="px-3 py-2 rounded-md border" :class="hasIssues ? 'bg-destructive/10 border-destructive/30' : 'bg-emerald-500/10 border-emerald-500/30'">
        <p class="text-xs" :class="hasIssues ? 'text-destructive' : 'text-emerald-400'">
          {{ hasIssues ? `发现 ${totalIssues} 个问题` : '✓ 配置正常，无冲突' }}
        </p>
      </div>

      <!-- IP Declaration Conflicts -->
      <div v-if="conflicts.length">
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">
          IP 声明冲突 ({{ conflicts.length }})
        </label>
        <p class="text-[11px] text-muted-foreground mt-1 mb-2">
          多个节点的 GLOBAL ALLOWED_IPS 声明了同一个 IP。WireGuard 会按 [Peer] 顺序选第一个，导致路由错误/丢包。
        </p>
        <div class="space-y-2">
          <div
            v-for="(c, i) in conflicts"
            :key="i"
            class="rounded-md border border-destructive/30 bg-destructive/5 p-3"
          >
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xs font-mono text-destructive">{{ c.ip }}</span>
              <span class="text-[10px] text-muted-foreground">被 {{ c.claimers.length }} 个节点声明</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <MiniCard
                v-for="claimer in c.claimers"
                :key="claimer.id"
                type="node"
                :name="claimer.name"
                :pubkey="claimer.id"
                full
                @click="$emit('select-node', claimer.id)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'

const props = defineProps<{
  graphData: any
}>()

defineEmits<{
  close: []
  'select-node': [nodeId: string]
}>()

const model = computed(() => new EasyWGSyncModel(props.graphData))
const health = computed(() => model.value.healthCheck())
const conflicts = computed(() => health.value.conflicts)
const totalIssues = computed(() => conflicts.value.length)
const hasIssues = computed(() => totalIssues.value > 0)
</script>
