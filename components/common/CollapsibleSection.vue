<template>
  <details :open="open" class="rounded-md border border-border group">
    <summary class="cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-2 text-xs font-medium text-foreground">
      <span class="flex items-center gap-1.5">
        <span class="text-[10px] text-muted-foreground transition-transform duration-150 group-open:rotate-90">▶</span>
        {{ title }}
      </span>
      <slot name="title-extra" />
    </summary>
    <div class="px-3 pb-3" :class="bodyClass">
      <slot />
    </div>
  </details>
</template>

<script setup lang="ts">
// Collapsible bordered section: a <details> with the shared summary chrome
// (field-label typography) + padded body. #title-extra slot for an action on the
// summary row (e.g. the "view full config" link).
withDefaults(defineProps<{
  title: string
  open?: boolean
  bodyClass?: string
}>(), {
  open: false,
  bodyClass: 'space-y-3',
})
</script>
