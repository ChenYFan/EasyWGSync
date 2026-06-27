<template>
  <span class="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full" :class="chipClass">
    <slot />
  </span>
</template>

<script setup lang="ts">
// Unified status chip / pill for all badges and tags.
// solid=true  → solid fill + foreground text (strong emphasis, e.g. ROAMING chip)
// solid=false → outlined tinted (pill style, e.g. Relay/Proxy node pills)
//
// Full literal class strings per tier so Tailwind JIT can detect them.

type Level = 'critical' | 'error' | 'warning' | 'important' | 'info' | 'success'

const props = withDefaults(defineProps<{
  level?: Level
  solid?: boolean
}>(), {
  level: 'info',
  solid: false,
})

const SOLID: Record<Level, string> = {
  critical:  'bg-critical text-critical-foreground font-semibold',
  error:     'bg-error text-error-foreground font-semibold',
  warning:   'bg-warning text-warning-foreground font-semibold',
  important: 'bg-important text-important-foreground font-semibold',
  info:      'bg-info text-info-foreground font-semibold',
  success:   'bg-success text-success-foreground font-semibold',
}
const OUTLINE: Record<Level, string> = {
  critical:  'border border-critical/40 bg-critical/10 text-critical',
  error:     'border border-error/40 bg-error/10 text-error',
  warning:   'border border-warning/40 bg-warning/10 text-warning',
  important: 'border border-important/40 bg-important/10 text-important',
  info:      'border border-info/40 bg-info/10 text-info',
  success:   'border border-success/40 bg-success/10 text-success',
}

const chipClass = computed(() => props.solid ? SOLID[props.level] : OUTLINE[props.level])
</script>
