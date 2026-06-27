<template>
  <ModalShell :visible="visible" :title="title" card-class="max-h-[60vh]" @close="$emit('close')">
    <CardGrid class="flex-1 overflow-y-auto p-4 content-start">
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
      <p v-if="!items.length" class="text-xs text-muted-foreground col-span-2 text-center py-4">{{ emptyText }}</p>
    </CardGrid>
  </ModalShell>
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
