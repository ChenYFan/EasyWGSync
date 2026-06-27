<template>
  <div class="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border shadow-xl z-50 flex flex-col">
    <div class="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
      <h3 class="text-sm font-medium text-foreground">Global Settings</h3>
      <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Listen Port</label>
        <input
          v-model.number="form.GLOBAL_LISTEN_PORT"
          type="number"
          class="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="e.g. 51820"
        />
      </div>

      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">DNS Enabled</label>
        <div class="mt-1 flex items-center gap-2">
          <input type="checkbox" v-model="form.GLOBAL_DNS" class="rounded border-input accent-foreground" />
          <span class="text-sm text-foreground">{{ form.GLOBAL_DNS ? 'Yes' : 'No' }}</span>
        </div>
      </div>

      <div>
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Scripts</label>
        <div class="mt-1 space-y-2">
          <div v-for="type in ['PreUp', 'PostUp', 'PreDown', 'PostDown']" :key="type">
            <label class="text-[10px] text-muted-foreground">{{ type }}</label>
            <textarea
              v-model="form.GLOBAL_SCRIPTS[type]"
              ref-for
              :ref="el => textareaRefs[type] = (el as HTMLTextAreaElement | null)"
              rows="1"
              @input="autoGrow($event)"
              class="w-full px-2 py-1.5 rounded border border-input bg-background text-xs text-foreground font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring overflow-hidden"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="h-14 flex items-center justify-end gap-2 px-4 border-t border-border shrink-0">
      <button
        @click="$emit('close')"
        class="h-8 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >Cancel</button>
      <button
        @click="handleSave"
        class="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
      >Save</button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  config: any
}>()

const emit = defineEmits<{
  close: []
  save: [data: any]
}>()

const form = reactive({
  GLOBAL_LISTEN_PORT: props.config?.GLOBAL_LISTEN_PORT || null,
  GLOBAL_DNS: props.config?.GLOBAL_DNS ?? true,
  GLOBAL_SCRIPTS: {
    PreUp: props.config?.GLOBAL_SCRIPTS?.PreUp || '',
    PostUp: props.config?.GLOBAL_SCRIPTS?.PostUp || '',
    PreDown: props.config?.GLOBAL_SCRIPTS?.PreDown || '',
    PostDown: props.config?.GLOBAL_SCRIPTS?.PostDown || '',
  } as Record<string, string>,
})

// Auto-grow textareas to fit content (no scrollbar at default height)
const textareaRefs = reactive<Record<string, HTMLTextAreaElement | null>>({})
function autoGrow(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}
onMounted(() => {
  nextTick(() => {
    for (const el of Object.values(textareaRefs)) {
      if (el) {
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
      }
    }
  })
})

function handleSave() {
  emit('save', {
    GLOBAL_LISTEN_PORT: form.GLOBAL_LISTEN_PORT || null,
    GLOBAL_DNS: form.GLOBAL_DNS,
    GLOBAL_SCRIPTS: form.GLOBAL_SCRIPTS,
  })
}
</script>
