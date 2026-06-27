<template>
  <SidePanel title="Edit Group" @close="$emit('close')">
      <div class="flex items-center gap-3">
        <span class="w-4 h-4 rounded-full" :style="{ backgroundColor: getGroupColor(groupName) }" />
        <h2 class="text-lg font-semibold text-foreground">{{ groupName }}</h2>
        <span
          v-if="isVirtual"
          class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
        >Virtual</span>
        <label v-if="!isVirtual" class="ml-auto flex items-center gap-2 cursor-pointer">
          <span class="field-label">Enabled</span>
          <Switch :model-value="enabled" @update:model-value="v => draftStore.setGroupEnabled(groupName, v)" />
        </label>
        <label v-else class="ml-auto flex items-center gap-2 cursor-pointer">
          <span class="field-label">Show Edges</span>
          <Switch :model-value="edgesVisible" @update:model-value="() => draftStore.toggleVirtualGroupVisible(groupName)" />
        </label>
      </div>

      <div v-if="isVirtual && !edgesVisible" class="px-3 py-2 rounded-md bg-muted/30 border border-border">
        <p class="text-xs text-muted-foreground">Center与其他节点的连接关系已隐藏</p>
      </div>

      <StatusBox v-if="!isVirtual && !enabled" level="warning">
        <p class="text-xs text-warning">此组已停用</p>
      </StatusBox>

      <!-- Comment (virtual groups have a fixed description; real groups have none) -->
      <div v-if="isVirtual">
        <label class="field-label">Comment</label>
        <p class="text-xs text-muted-foreground mt-1 italic">{{ groupData?.comment }}</p>
      </div>

      <!-- Members (edits mutate the draft live) -->
      <div>
        <div class="flex items-center justify-between">
          <label class="field-label">Members ({{ memberNodes.length }})</label>
          <button
            v-if="!isVirtual"
            @click="showAddPeer = true"
            class="text-xs text-muted-foreground hover:text-foreground"
          >+ Add</button>
        </div>
        <CardGrid class="mt-1.5">
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
        </CardGrid>
      </div>

      <div v-if="!isVirtual" class="pt-2">
        <button
          @click="handleDelete"
          class="w-full btn-danger"
        >Delete Group</button>
      </div>

    <template #footer>
      <button
        @click="$emit('close')"
        class="btn-ghost"
      >Close</button>
    </template>

    <!-- Add Peer Modal (reuses the shared selection list) -->
    <template #overlay>
      <SelectionModal
        :visible="showAddPeer"
        :title="`Add Peer to ${groupName}`"
        item-type="node"
        :items="availablePeers"
        empty-text="All peers are already in this group"
        @close="showAddPeer = false"
        @select="addMember"
      />
    </template>
  </SidePanel>
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

const memberIds = computed(() => new Set(memberNodes.value.map(m => m.id)))

// Available peers (not center, not already a member)
const availablePeers = computed(() => {
  return props.graphData.nodes
    .filter((n: any) => !n.data?.isCenter && !memberIds.value.has(n.id))
    .map((n: any) => ({
      id: n.id,
      name: model.value.getNodeName(n.id),
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
