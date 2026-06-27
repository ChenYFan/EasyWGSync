<template>
  <ModalShell :visible="visible" :z="200" width="680px" card-class="max-h-[80vh]" header-class="h-14 px-6" footer-class="px-6" @close="$emit('close')">
    <template #header>
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-medium text-foreground">Save &amp; Preview</h3>
        <span v-if="changed" class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
          {{ addCount }} additions, {{ delCount }} deletions
        </span>
      </div>
    </template>

    <div class="flex-1 overflow-auto p-0">
      <div v-if="!changed" class="p-6 text-center text-sm text-muted-foreground">No changes to save</div>
      <pre v-else class="text-[11px] font-mono leading-relaxed"><code><span
        v-for="(line, i) in diff"
        :key="i"
        class="block px-4"
        :class="{
          'bg-success/15 text-success': line.type === 'add',
          'bg-error/15 text-error': line.type === 'del',
          'text-muted-foreground': line.type === 'ctx',
        }"
      >{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }} {{ line.text }}</span></code></pre>
    </div>

    <template #footer>
      <button
        v-if="changed"
        @click="$emit('discard')"
        class="h-8 px-3 rounded-md text-sm text-destructive hover:bg-destructive/10"
      >Discard All</button>
      <button
        @click="$emit('close')"
        class="btn-ghost"
      >Cancel</button>
      <button
        @click="$emit('save')"
        :disabled="!changed"
        class="btn-primary disabled:opacity-40"
      >Save All</button>
    </template>
  </ModalShell>
</template>

<script setup lang="ts">
import { jsonLineDiff, hasDiff } from '~/composables/useJsonDiff'

const props = defineProps<{
  visible: boolean
  before: any
  after: any
}>()

defineEmits<{
  close: []
  save: []
  discard: []
}>()

const diff = computed(() => jsonLineDiff(props.before, props.after))
const changed = computed(() => hasDiff(diff.value))
const addCount = computed(() => diff.value.filter(l => l.type === 'add').length)
const delCount = computed(() => diff.value.filter(l => l.type === 'del').length)
</script>
