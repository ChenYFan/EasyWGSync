<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    @click="$emit('update:modelValue', !modelValue)"
    class="relative w-9 h-5 rounded-full transition-colors"
    :class="modelValue ? 'bg-success' : 'bg-muted'"
  >
    <span
      class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
      :class="modelValue ? 'translate-x-4' : ''"
    />
  </button>
</template>

<script setup lang="ts">
// Boolean on/off switch (v-model). Sibling to ModeToggle (which is append/override).
defineProps<{ modelValue: boolean }>()
defineEmits<{ 'update:modelValue': [v: boolean] }>()
</script>
