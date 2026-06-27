<template>
  <div class="fixed inset-y-0 right-0 w-full sm:w-[420px] max-w-full bg-card border-l border-border shadow-xl z-50 flex flex-col">
    <div class="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <h3 class="text-sm font-medium text-foreground truncate">{{ title }}</h3>
        <slot name="header-extra" />
      </div>
      <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg shrink-0">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto" :class="bodyClass">
      <slot />
    </div>

    <div v-if="$slots.footer" class="h-14 flex items-center justify-end gap-2 px-4 border-t border-border shrink-0">
      <slot name="footer" />
    </div>

    <!-- Overlays (modals etc.) — position:fixed, rendered outside the scroll area -->
    <slot name="overlay" />
  </div>
</template>

<script setup lang="ts">
// Right-side drawer panel shell: fixed 420px column + h14 header (title + close,
// optional #header-extra chips) + scrolling body + optional #footer + #overlay
// (for modals). The ONE source of drawer chrome — every *Panel composes this.
withDefaults(defineProps<{
  title: string
  /** Body padding/spacing (most panels use space-y-4; some 3 or 5). */
  bodyClass?: string
}>(), {
  bodyClass: 'p-4 space-y-4',
})

defineEmits<{ close: [] }>()
</script>
