<template>
  <select
    :value="modelValue"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    class="field-input w-full mt-1"
  >
    <option value="">{{ placeholder }}</option>
    <option v-for="o in options" :key="o.id" :value="o.id">{{ o.name }}</option>
  </select>
</template>

<script setup lang="ts">
// A peer-picker <select> (v-model). The repeated "Select… + peerOptions" dropdown.
withDefaults(defineProps<{
  modelValue: string
  options: { id: string; name: string }[]
  placeholder?: string
}>(), {
  placeholder: 'Select...',
})

defineEmits<{ 'update:modelValue': [v: string] }>()
</script>
