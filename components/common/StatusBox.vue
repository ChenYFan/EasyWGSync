<template>
  <div class="rounded-md border p-3" :class="boxClass">
    <p v-if="title" class="text-[10px] uppercase tracking-wider font-semibold" :class="labelClass">{{ title }}</p>
    <div :class="title ? 'mt-1.5' : ''">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
// Unified status box for all alert / status messages.
// level → one of the 6 semantic tiers. Colors come from the semantic palette
// (assets/css/main.css + tailwind.config.ts), brightened for dark mode.
//
// Full literal class strings per tier so Tailwind JIT can detect them
// (dynamic `bg-${level}/10` would NOT be scanned).

type Level = 'critical' | 'error' | 'warning' | 'important' | 'info' | 'success'

const props = withDefaults(defineProps<{
  level?: Level
  title?: string
}>(), {
  level: 'info',
})

const BOX: Record<Level, string> = {
  critical:  'border-critical/50 bg-critical/10',
  error:     'border-error/50 bg-error/10',
  warning:   'border-warning/50 bg-warning/10',
  important: 'border-important/50 bg-important/10',
  info:      'border-info/50 bg-info/10',
  success:   'border-success/50 bg-success/10',
}
const LABEL: Record<Level, string> = {
  critical:  'text-critical',
  error:     'text-error',
  warning:   'text-warning',
  important: 'text-important',
  info:      'text-info',
  success:   'text-success',
}

const boxClass = computed(() => BOX[props.level])
const labelClass = computed(() => LABEL[props.level])
</script>
