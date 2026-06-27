<template>
  <StatusBox :level="level">
    <div class="mb-2">
      <div class="text-xs text-foreground">{{ title }}</div>
      <div class="text-[11px] text-muted-foreground mt-0.5">
        <slot name="sub">{{ sub }}</slot>
      </div>
    </div>
    <div v-if="nodes.length" class="flex flex-wrap gap-1.5">
      <MiniCard
        v-for="n in nodes"
        :key="n.id"
        type="node"
        :name="n.name"
        :pubkey="n.id"
        full
        @click="$emit('select', n.id)"
      />
    </div>
  </StatusBox>
</template>

<script setup lang="ts">
// A health "finding" row: a StatusBox holding a plain-text node-name header +
// a one-line description (sub prop, or #sub slot for styled content) + the list
// of related node cards. The shared shape behind gateway/relay-uniqueness,
// duplicate-AllowedIPs, and one-way-unreachable findings.
defineProps<{
  level: 'error' | 'warning' | 'success'
  title: string
  sub?: string
  nodes: { id: string; name: string }[]
}>()

defineEmits<{ select: [id: string] }>()
</script>
