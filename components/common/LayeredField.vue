<template>
  <div class="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-1.5">
    <div class="flex items-center justify-between">
      <span class="field-label">{{ label }}</span>
      <span v-if="conv.deleted" class="text-[9px] px-1.5 py-0.5 rounded-full bg-error/15 text-error">已删除</span>
    </div>

    <div v-if="conv.final !== null" class="text-xs font-mono text-foreground break-all whitespace-pre-wrap">{{ fmt(conv.final) }}</div>
    <div v-else class="text-xs font-mono text-muted-foreground italic">{{ conv.deleted ? '已删除' : '空' }}</div>

    <!-- Changelog: every modification record in order -->
    <div v-if="conv.history.length > 1 || (conv.history.length === 1 && conv.history[0].layer !== 'default')" class="space-y-0.5 pt-1 border-t border-border/40">
      <div v-for="(m, i) in conv.history" :key="i" class="flex gap-1.5 text-[10px] items-start">
        <span class="shrink-0 w-px h-3" />
        <span class="shrink-0 px-1 rounded text-[9px]" :class="badgeClass(m)">{{ originLabel(m) }}</span>
        <span class="shrink-0 text-muted-foreground/60">{{ opLabel(m.op) }}</span>
        <span class="font-mono break-all whitespace-pre-wrap" :class="m.superseded ? 'text-muted-foreground/40 line-through' : textClass(m)">{{ m.op === 'none' ? '—' : fmt(m.value) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Converged, DisplayMod } from '~/composables/useRenderModel'

const props = defineProps<{
  label: string
  /** A converged field: final value + ordered changelog. */
  conv: Converged
  /** Display-only line wrapping: 'comma' (IPs) breaks at ',', 'semicolon' (scripts) at ';'. */
  wrap?: 'comma' | 'semicolon'
}>()

// Display-only reflow — does NOT change the stored value.
function fmt(s: string): string {
  if (!s) return s
  if (props.wrap === 'comma') return s.split(',').map(x => x.trim()).filter(Boolean).join('\n')
  if (props.wrap === 'semicolon') return s.split(';').map(x => x.trim()).filter(Boolean).join(';\n')
  return s
}

// origin → human label. declaration origins carry their kind ('relay', 'gateway:X', ...).
function originLabel(m: DisplayMod): string {
  if (m.layer === 'default') return '默认'
  if (m.layer === 'extra') return '手动'
  const o = m.origin || 'declaration'
  if (o === 'relay') return '高级+中继'
  if (o === 'proxy') return '高级+代理'
  if (o === 'center-gateway') return '高级+中心网关'
  if (o.startsWith('gateway:')) return '高级+网关'
  return '高级'
}
function opLabel(op: string): string {
  return op === 'append' ? '续增' : op === 'none' ? '删除' : '覆盖'
}
function badgeClass(m: DisplayMod): string {
  if (m.layer === 'default') return 'bg-muted text-muted-foreground'
  if (m.layer === 'extra') return 'bg-info/15 text-info'
  return 'bg-important/15 text-important'
}
function textClass(m: DisplayMod): string {
  if (m.layer === 'default') return 'text-muted-foreground'
  if (m.layer === 'extra') return 'text-info'
  return 'text-important'
}
</script>
