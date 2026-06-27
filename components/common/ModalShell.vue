<template>
  <div v-if="visible" class="fixed inset-0 flex items-center justify-center" :class="zClass">
    <div class="absolute inset-0 bg-background/80" @click="$emit('close')" />

    <div
      class="relative bg-card border border-border rounded-xl shadow-2xl flex flex-col"
      :class="cardClass"
      :style="{ width, maxWidth }"
    >
      <!-- Header: title or #header slot + close; omitted entirely if neither. -->
      <div
        v-if="title || $slots.header"
        class="flex items-center justify-between border-b border-border shrink-0 gap-3"
        :class="headerClass"
      >
        <slot name="header">
          <span class="text-sm font-medium text-foreground truncate">{{ title }}</span>
        </slot>
        <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg shrink-0">&times;</button>
      </div>

      <slot />

      <div v-if="$slots.footer" class="h-14 flex items-center justify-end gap-2 border-t border-border shrink-0" :class="footerClass">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Centered modal overlay primitive: backdrop (click = close) + card frame +
// optional header bar (title/close) + optional footer. Body is the default
// slot. The ONE source of modal chrome — every dialog composes this instead of
// re-deriving the overlay/card markup.
const props = withDefaults(defineProps<{
  visible: boolean
  /** Card width (any CSS length). */
  width?: string
  /** Optional max width (e.g. for responsive vw widths). */
  maxWidth?: string
  /** Stack level: 100 (default) sits above panels; 200 above other modals. */
  z?: 100 | 200
  /** Header bar sizing/padding (height + horizontal padding). */
  headerClass?: string
  /** Card height/scroll classes (e.g. 'h-[85vh]', 'max-h-[80vh]'). */
  cardClass?: string
  /** Footer bar horizontal padding (to match header). */
  footerClass?: string
  /** Header title shorthand (use #header slot for richer headers). */
  title?: string
}>(), {
  width: '400px',
  maxWidth: '92vw',
  z: 100,
  headerClass: 'h-12 px-4',
  cardClass: '',
  footerClass: 'px-4',
})

defineEmits<{ close: [] }>()

// Tailwind needs static class strings — map the numeric level.
const zClass = computed(() => (props.z === 200 ? 'z-[200]' : 'z-[100]'))
</script>
