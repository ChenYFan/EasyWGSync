<template>
  <div class="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border shadow-xl z-50 flex flex-col">
    <div class="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
      <h3 class="text-sm font-medium text-foreground">Edit Group</h3>
      <button @click="$emit('close')" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Group name + color + enabled toggle -->
      <div class="flex items-center gap-3">
        <span class="w-4 h-4 rounded-full" :style="{ backgroundColor: getGroupColor(groupName) }" />
        <h2 class="text-lg font-semibold text-foreground">{{ groupName }}</h2>
        <span
          v-if="isVirtual"
          class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
        >Virtual</span>
        <label v-if="!isVirtual" class="ml-auto flex items-center gap-2 cursor-pointer">
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Enabled</span>
          <button
            type="button"
            role="switch"
            :aria-checked="enabled"
            @click="toggleEnabled"
            class="relative w-9 h-5 rounded-full transition-colors"
            :class="enabled ? 'bg-emerald-500' : 'bg-muted'"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              :class="enabled ? 'translate-x-4' : ''"
            />
          </button>
        </label>
        <label v-else class="ml-auto flex items-center gap-2 cursor-pointer">
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Show Edges</span>
          <button
            type="button"
            role="switch"
            :aria-checked="edgesVisible"
            @click="draftStore.toggleVirtualGroupVisible(groupName)"
            class="relative w-9 h-5 rounded-full transition-colors"
            :class="edgesVisible ? 'bg-emerald-500' : 'bg-muted'"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              :class="edgesVisible ? 'translate-x-4' : ''"
            />
          </button>
        </label>
      </div>

      <div v-if="isVirtual && !edgesVisible" class="px-3 py-2 rounded-md bg-muted/30 border border-border">
        <p class="text-xs text-muted-foreground">此组的连接关系已隐藏（成员节点仍显示）</p>
      </div>

      <div v-if="!isVirtual && !enabled" class="px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
        <p class="text-xs text-yellow-400">此组已停用</p>
      </div>

      <!-- Comment (virtual groups have a fixed description; real groups have none) -->
      <div v-if="isVirtual">
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Comment</label>
        <p class="text-xs text-muted-foreground mt-1 italic">{{ groupData?.comment }}</p>
      </div>

      <!-- Members (edits mutate the draft live) -->
      <div>
        <div class="flex items-center justify-between">
          <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Members ({{ memberNodes.length }})</label>
          <button
            v-if="!isVirtual"
            @click="showAddPeer = true"
            class="text-xs text-muted-foreground hover:text-foreground"
          >+ Add</button>
        </div>
        <div class="mt-1.5 grid grid-cols-2 gap-1.5 items-start">
          <div
            v-for="member in memberNodes"
            :key="member.id"
            class="relative group"
            :class="member.isVirtual ? 'col-span-2' : ''"
          >
            <MiniCard
              type="node"
              :name="member.name"
              :pubkey="member.pubkey"
              :comment="member.comment"
              :ipv4="member.ipv4"
              :virtual="member.isVirtual"
              full
              @click="$emit('select-node', member.id)"
            />
            <button
              v-if="!isVirtual && !member.isVirtual"
              @click="removeMember(member.id)"
              class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-xs hidden group-hover:flex items-center justify-center shadow"
            >&times;</button>
          </div>
          <p v-if="!memberNodes.length" class="col-span-2 text-xs text-muted-foreground">No members</p>
        </div>
      </div>

      <!-- Connections (not for virtual groups) -->
      <div v-if="!isVirtual">
        <label class="text-[10px] uppercase tracking-wider text-muted-foreground">Connections ({{ connectionCount }})</label>
      </div>

      <!-- Delete group -->
      <div v-if="!isVirtual" class="pt-2">
        <button
          @click="handleDelete"
          class="w-full h-8 rounded-md border border-destructive/30 text-xs text-destructive hover:bg-destructive/10"
        >Delete Group</button>
      </div>
    </div>

    <div class="h-14 flex items-center justify-end gap-2 px-4 border-t border-border shrink-0">
      <button
        @click="$emit('close')"
        class="h-8 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >Close</button>
    </div>

    <!-- Add Peer Modal -->
    <div v-if="showAddPeer" class="fixed inset-0 z-[100] flex items-center justify-center">
      <div class="absolute inset-0 bg-background/80" @click="showAddPeer = false" />
      <div class="relative bg-card border border-border rounded-xl shadow-2xl w-[400px] max-h-[60vh] flex flex-col">
        <div class="h-12 flex items-center justify-between px-4 border-b border-border">
          <span class="text-sm font-medium">Add Peer to {{ groupName }}</span>
          <button @click="showAddPeer = false" class="text-muted-foreground hover:text-foreground text-lg">&times;</button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 flex flex-wrap gap-1.5">
          <MiniCard
            v-for="peer in availablePeers"
            :key="peer.id"
            type="node"
            :name="peer.name"
            :ipv4="peer.ipv4"
            :comment="peer.comment"
            @click="addMember(peer.id)"
          />
          <p v-if="!availablePeers.length" class="text-xs text-muted-foreground">All peers are already in this group</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getGroupColor } from '~/composables/useMeshGraph'
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'
import { useDraft } from '~/composables/useDraft'

const props = defineProps<{
  groupName: string
  graphData: any
}>()

const emit = defineEmits<{
  close: []
  saved: []
  'select-node': [nodeId: string]
}>()

const draftStore = useDraft()
const model = computed(() => new EasyWGSyncModel(props.graphData))

const groupData = computed(() => model.value.getGroup(props.groupName))
const isVirtual = computed(() => model.value.isVirtualGroup(props.groupName))
const enabled = computed(() => props.graphData.meshGroups?.[props.groupName]?.enabled !== false)
const edgesVisible = computed(() => !draftStore.hiddenVirtualGroups.value?.has(props.groupName))
const memberNodes = computed(() => model.value.getGroupMembersInfo(props.groupName))
const connectionCount = computed(() => memberNodes.value.length * (memberNodes.value.length - 1))
const showAddPeer = ref(false)

function toggleEnabled() {
  draftStore.setGroupEnabled(props.groupName, !enabled.value)
}

const memberIds = computed(() => new Set(memberNodes.value.map(m => m.id)))

// Available peers (not center, not already a member)
const availablePeers = computed(() => {
  return props.graphData.nodes
    .filter((n: any) => !n.data?.isCenter && !memberIds.value.has(n.id))
    .map((n: any) => ({
      id: n.id,
      name: n.data?.fileName || n.id.slice(0, 12),
      ipv4: model.value.getRealIPv4(n.id),
      comment: n.data?.comments || '',
    }))
})

// Edits mutate the draft directly — graph + member list update live
function addMember(peerId: string) {
  draftStore.addToGroup(props.groupName, peerId)
  showAddPeer.value = false
}

function removeMember(peerId: string) {
  draftStore.removeFromGroup(props.groupName, peerId)
}

function handleDelete() {
  if (!confirm(`Delete group "${props.groupName}"?`)) return
  draftStore.deleteGroup(props.groupName)
  emit('saved')
}
</script>
