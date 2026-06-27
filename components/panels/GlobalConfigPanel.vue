<template>
  <SidePanel title="Global Settings" @close="$emit('close')">
      <div>
        <label class="field-label">Listen Port</label>
        <input
          v-model.number="form.GLOBAL_LISTEN_PORT"
          type="number"
          class="mt-1 w-full field-input font-mono"
          placeholder="e.g. 51820"
        />
      </div>

      <div>
        <label class="field-label">DNS Enabled</label>
        <div class="mt-1 flex items-center gap-2">
          <input type="checkbox" v-model="form.GLOBAL_DNS" class="rounded border-input accent-foreground" />
          <span class="text-sm text-foreground">{{ form.GLOBAL_DNS ? 'Yes' : 'No' }}</span>
        </div>
      </div>

      <div>
        <label class="field-label">Scripts</label>
        <div class="mt-1 space-y-2">
          <div v-for="type in ['PreUp', 'PostUp', 'PreDown', 'PostDown']" :key="type">
            <label class="text-[10px] text-muted-foreground">{{ type }}</label>
            <textarea
              v-model="form.GLOBAL_SCRIPTS[type]"
              ref-for
              :ref="el => textareaRefs[type] = (el as HTMLTextAreaElement | null)"
              rows="1"
              @input="autoGrow($event)"
              class="w-full field-textarea overflow-hidden"
            />
          </div>
        </div>
      </div>

      <template #footer>
        <button
          @click="$emit('close')"
          class="btn-ghost"
        >Cancel</button>
        <button
          @click="handleSave"
          class="btn-primary"
        >Save</button>
      </template>
  </SidePanel>
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
