<template>
  <div class="inline-flex rounded-md border border-border overflow-hidden text-[9px]">
    <button
      type="button"
      @click="$emit('update:modelValue', 'override')"
      class="px-2 py-0.5 transition-colors"
      :class="modelValue === 'override' ? 'bg-info text-info-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'"
    >覆盖</button>
    <button
      type="button"
      @click="$emit('update:modelValue', 'append')"
      class="px-2 py-0.5 transition-colors"
      :class="modelValue === 'append' ? 'bg-important text-important-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'"
    >续增</button>
  </div>
</template>

<script setup lang="ts">
import type { FieldMode } from '~/composables/useConfigModel'

defineProps<{ modelValue: FieldMode }>()
defineEmits<{ 'update:modelValue': [v: FieldMode] }>()
</script>
