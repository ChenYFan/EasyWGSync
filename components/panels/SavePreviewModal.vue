<template>
  <div v-if="visible" class="fixed inset-0 z-[200] flex items-center justify-center">
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-background/80" @click="$emit('close')" />

    <!-- Modal -->
    <div class="relative bg-card border border-border rounded-xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col">
      <div class="h-14 flex items-center justify-between px-6 border-b border-border shrink-0">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-medium text-foreground">Save &amp; Preview</h3>
          <span v-if="changed" class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {{ addCount }} additions, {{ delCount }} deletions
          </span>
        </div>
        <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
      </div>

      <div class="flex-1 overflow-auto p-0">
        <div v-if="!changed" class="p-6 text-center text-sm text-muted-foreground">No changes to save</div>
        <pre v-else class="text-[11px] font-mono leading-relaxed"><code><span
          v-for="(line, i) in diff"
          :key="i"
          class="block px-4"
          :class="{
            'bg-emerald-500/15 text-emerald-300': line.type === 'add',
            'bg-destructive/15 text-destructive': line.type === 'del',
            'text-muted-foreground': line.type === 'ctx',
          }"
        >{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }} {{ line.text }}</span></code></pre>
      </div>

      <div class="h-14 flex items-center justify-end gap-2 px-6 border-t border-border shrink-0">
        <button
          v-if="changed"
          @click="$emit('discard')"
          class="h-8 px-3 rounded-md text-sm text-destructive hover:bg-destructive/10"
        >Discard All</button>
        <button
          @click="$emit('close')"
          class="h-8 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground"
        >Cancel</button>
        <button
          @click="$emit('save')"
          :disabled="!changed"
          class="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
        >Save All</button>
      </div>
    </div>
  </div>
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
