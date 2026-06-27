<template>
  <div v-if="visible" class="fixed inset-0 z-[100] flex items-center justify-center">
    <div class="absolute inset-0 bg-background/80" @click="$emit('close')" />
    <div class="relative bg-card border border-border rounded-xl shadow-2xl w-[400px] max-h-[60vh] flex flex-col">
      <div class="h-12 flex items-center justify-between px-4 border-b border-border">
        <span class="text-sm font-medium text-foreground">{{ title }}</span>
        <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
      </div>
      <div class="flex-1 overflow-y-auto p-4 flex flex-wrap gap-1.5">
        <MiniCard
          v-for="item in items"
          :key="item.id"
          :type="itemType"
          :name="item.name"
          :color="item.color"
          :ipv4="item.ipv4"
          :comment="item.comment"
          :virtual="item.virtual"
          @click="$emit('select', item.id)"
        />
        <p v-if="!items.length" class="text-xs text-muted-foreground w-full text-center py-4">{{ emptyText }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  title: string
  itemType: 'node' | 'group'
  items: { id: string; name: string; color?: string; ipv4?: string; comment?: string; virtual?: boolean }[]
  emptyText?: string
}>()

defineEmits<{
  close: []
  select: [id: string]
}>()
</script>
