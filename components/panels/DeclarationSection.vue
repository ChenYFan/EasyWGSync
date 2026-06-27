<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <label class="field-label">{{ label }}</label>
      <button @click="$emit('add')" class="text-xs text-muted-foreground hover:text-foreground">+ Add</button>
    </div>
    <p class="text-[10px] text-muted-foreground mb-2">{{ description }}</p>
    <div class="space-y-1.5">
      <div
        v-for="(it, i) in items"
        :key="i"
        class="flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors cursor-pointer hover:border-foreground/30"
        :class="it.enabled === false
          ? 'bg-warning/10 border-warning/50'
          : isHighlighted(it.pub, it.priv)
            ? 'border-important bg-important/10 ring-1 ring-important'
            : 'bg-background border-border'"
        @click="$emit('edit', it)"
      >
        <span class="text-xs text-foreground truncate">{{ it.left }}</span>
        <span class="text-[10px] text-muted-foreground">→</span>
        <span class="text-xs text-foreground truncate">{{ it.right }}</span>
        <span v-if="it.type" class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{{ it.type }}</span>
        <span v-if="it.enabled === false" class="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning">Disabled</span>
        <button @click.stop="$emit('remove', it.pub, it.priv)" class="ml-auto text-xs text-destructive hover:text-destructive/80">&times;</button>
      </div>
      <p v-if="!items.length" class="text-xs text-muted-foreground">{{ emptyText }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// One HybridMesh declaration list (Relay / Proxy / Gateway / Roaming). Rows are
// clickable (emit `edit` with the row) to open the shared add/edit modal; the ×
// removes. Disabled (ENABLED:false) rows render dimmed with a badge.
export interface DeclarationRow {
  pub: string          // PUBLIC_PEER — for highlight + remove (direction-agnostic)
  priv: string         // PRIVATE_PEER
  left: string         // left display name
  right: string        // right display name
  type?: string        // optional pill (e.g. Roaming TYPE)
  enabled?: boolean    // ENABLED flag (false → dimmed + "Disabled" badge)
}

const props = defineProps<{
  label: string
  description: string
  items: DeclarationRow[]
  emptyText: string
  highlight?: { pub: string; priv: string } | null
}>()

defineEmits<{
  add: []
  remove: [pub: string, priv: string]
  edit: [row: DeclarationRow]
}>()

// A row matches the highlight if its pub/priv match in either direction.
function isHighlighted(pub: string, priv: string): boolean {
  const h = props.highlight
  if (!h) return false
  return (h.pub === pub && h.priv === priv) || (h.pub === priv && h.priv === pub)
}
</script>
