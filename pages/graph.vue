<template>
  <div class="h-full flex relative" @click="closeContextMenu" @contextmenu.prevent>
    <!-- Mobile drawer backdrop (below lg, only when open) -->
    <div
      v-if="mobileSidebarOpen"
      class="lg:hidden fixed inset-0 top-14 bg-background/60 z-30"
      @click="closeSidebar"
    />
    <!-- Mesh Groups sidebar. Static column at lg+; off-canvas drawer below lg. -->
    <aside
      class="border-r border-border p-4 flex flex-col gap-4 overflow-y-auto bg-background
             w-64 shrink-0
             max-lg:fixed max-lg:inset-y-0 max-lg:top-14 max-lg:left-0 max-lg:z-40 max-lg:w-72 max-lg:shadow-xl
             max-lg:transition-transform max-lg:duration-200"
      :class="mobileSidebarOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'"
    >
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mesh Groups</h2>
          <button
            @click="showCreateGroup = true"
            class="text-xs text-muted-foreground hover:text-foreground"
          >+ New</button>
        </div>
        <!-- Virtual groups first, then real — each expandable to list members -->
        <div
          v-for="{ name, group } in sortedGroups"
          :key="name"
          class="rounded-md transition-colors"
          :class="{
            'bg-secondary': selectedGroup === name,
            'bg-secondary/30': !selectedGroup && selectedPeer && group.members.includes(selectedPeer),
            'bg-warning/10 border border-warning/50': group.enabled === false,
          }"
        >
          <div
            class="flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-sm"
            :class="{ 'hover:bg-secondary/50': selectedGroup !== name && group.enabled !== false }"
            @click="selectGroup(name)"
            @contextmenu.prevent="onGroupRightClick($event, name)"
          >
            <button
              class="shrink-0 w-4 h-4 flex items-center justify-center text-[9px] text-muted-foreground hover:text-foreground transition-transform"
              :class="expandedGroups.has(name) ? 'rotate-90' : ''"
              @click.stop="toggleGroupExpand(name)"
            >▶</button>
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: getGroupColor(name) }" />
            <span class="truncate text-foreground">{{ name }}</span>
            <span v-if="group.virtual" class="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground ml-1">Virtual</span>
            <span v-else-if="group.enabled === false" class="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning ml-1">Disabled</span>
            <span class="ml-auto text-xs text-muted-foreground">{{ group.members.length }}</span>
          </div>
          <div v-if="expandedGroups.has(name)" class="pl-7 pr-2 pb-1.5 space-y-0.5">
            <div
              v-for="m in groupMemberInfo(name)"
              :key="m.id"
              class="text-xs truncate cursor-pointer py-0.5"
              :class="selectedPeer === m.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click.stop="onNodeClick(m.id)"
            >{{ m.name }}</div>
            <p v-if="!group.members.length" class="text-[11px] text-muted-foreground/50 py-0.5">无成员</p>
          </div>
        </div>
      </div>

      <div class="mt-auto pt-4 border-t border-border space-y-1">
        <button
          @click="toggleTool('hybrid')"
          class="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-secondary"
          :class="showHybridMesh ? 'text-foreground bg-secondary' : 'text-muted-foreground hover:text-foreground'"
        >Hybrid Mesh</button>
        <button
          @click="toggleTool('health')"
          class="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-secondary flex items-center justify-between"
          :class="showHealthCheck ? 'text-foreground bg-secondary' : 'text-muted-foreground hover:text-foreground'"
        >
          <span>Health Check</span>
          <span v-if="conflictCount > 0" class="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive">{{ conflictCount }}</span>
        </button>
        <button
          @click="toggleTool('global')"
          class="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-secondary"
          :class="showGlobalConfig ? 'text-foreground bg-secondary' : 'text-muted-foreground hover:text-foreground'"
        >Global Settings</button>
      </div>
    </aside>

    <!-- Main graph area -->
    <div class="flex-1 relative">
      <MeshCanvas
        v-if="loaded"
        :data="graphData"
        :selected-group="selectedGroup"
        :selected-node="selectedPeer"
        :selected-edge="selectedEdge ? { source: selectedEdge.source, target: selectedEdge.target } : null"
        :trace-path="traceHighlight"
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
        @node-right-click="onNodeRightClick"
        @edge-right-click="onEdgeRightClick"
        @group-right-click="onCanvasGroupRightClick"
      />
      <div v-else class="flex items-center justify-center h-full">
        <p class="text-sm text-muted-foreground">Loading graph...</p>
      </div>
    </div>

    <!-- Slide-over panels -->
    <PeerEditPanel
      v-if="activePanel === 'peer'"
      :key="selectedPeer!"
      :pubkey="selectedPeer!"
      :config="peerConfig"
      :graph-data="graphData"
      @close="clearSelection"
      @save="savePeer"
      @select-node="onNodeClick"
      @select-group="selectGroup"
      @goto-hybrid="onGotoHybrid"
    />
    <EdgeEditPanel
      v-else-if="activePanel === 'edge'"
      :key="selectedEdge?.id"
      :edge="selectedEdge"
      :graph-data="graphData"
      @close="clearSelection"
      @save="saveEdge"
      @reset="resetEdge"
      @select-node="onNodeClick"
      @select-group="selectGroup"
      @goto-hybrid="onGotoHybrid"
    />
    <GroupEditPanel
      v-else-if="activePanel === 'group'"
      :key="selectedGroup!"
      :group-name="selectedGroup!"
      :graph-data="graphData"
      @close="clearSelection"
      @saved="onPanelSaved"
      @select-node="onNodeClick"
    />
    <TraceRoutePanel
      v-else-if="activePanel === 'traceroute'"
      :source-id="traceSource!"
      :graph-data="graphData"
      @close="clearSelection"
      @select-node="onNodeClick"
      @trace-result="onTraceResult"
    />
    <GlobalConfigPanel
      v-else-if="activePanel === 'global'"
      :config="graphData.globalConfig"
      @close="closeTool"
      @save="saveGlobalConfig"
    />
    <HealthCheckPanel
      v-else-if="activePanel === 'health'"
      :graph-data="graphData"
      @close="closeTool"
      @select-node="onNodeClick"
    />
    <HybridMeshPanel
      v-else-if="activePanel === 'hybrid'"
      :graph-data="graphData"
      :highlight="highlightDecl"
      @close="closeTool"
    />

    <!-- Context Menu -->
    <ContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :type="contextMenu.type"
      :header-name="contextMenu.headerName"
      :header-sub="contextMenu.headerSub"
      :conn-source="contextMenu.connSource"
      :conn-target="contextMenu.connTarget"
      @close="closeContextMenu"
      @add-to-group="onAddToGroup"
      @remove-from-group="onRemoveFromGroup"
      @traceroute="onStartTrace"
      @relay-for="onRelayFor"
      @proxy-for="onProxyFor"
      @add-peer="onAddPeerToGroup"
      @delete-group="onContextMenuDeleteGroup"
      @set-gateway="onSetGateway"
      @set-default="onSetDefault"
    />

    <!-- Save Preview Modal -->
    <SavePreviewModal
      :visible="previewOpen"
      :before="persisted"
      :after="draft"
      @close="previewOpen = false"
      @save="saveAll"
      @discard="discardAll"
    />

    <!-- Selection Modal (Add to Group / Remove from Group / Add Peer) -->
    <SelectionModal
      :visible="selectionModal.visible"
      :title="selectionModal.title"
      :item-type="selectionModal.itemType"
      :items="selectionModal.items"
      empty-text="No items available"
      @close="selectionModal.visible = false"
      @select="onSelectionSelect"
    />

    <!-- Create Group Modal -->
    <ModalShell :visible="showCreateGroup" :z="200" title="New Mesh Group" @close="showCreateGroup = false">
      <div class="p-4 space-y-3">
        <div>
          <label class="field-label">Group Name</label>
          <input
            v-model="newGroupName"
            class="mt-1 w-full field-input font-mono"
            placeholder="e.g. OFFICE_MESH"
            @keydown.enter="createGroup"
          />
          <p v-if="createGroupError" class="text-xs text-destructive mt-1">{{ createGroupError }}</p>
        </div>
      </div>
      <template #footer>
        <button @click="showCreateGroup = false" class="btn-ghost">Cancel</button>
        <button @click="createGroup" class="btn-primary">Create</button>
      </template>
    </ModalShell>
  </div>
</template>

<script setup lang="ts">
import { getGroupColor } from '~/composables/useMeshGraph'
import { useDraft } from '~/composables/useDraft'
import { EasyWGSyncModel } from '~/composables/useEasyWGSync'

definePageMeta({ layout: 'default' })

const draftStore = useDraft()
const { graphData, loaded, persisted, draft, previewOpen } = draftStore

// Mobile off-canvas sidebar (coordinated with the header hamburger).
const { mobileSidebarOpen, closeSidebar } = useUiState()

// Mesh groups (incl. virtual) derived live from the draft
const meshGroups = computed(() => graphData.value.meshGroups)

// Sidebar: virtual groups first, then real (insertion order preserved within each).
const sortedGroups = computed(() => {
  const entries = Object.entries(meshGroups.value) as [string, any][]
  return [...entries.filter(([, g]) => g.virtual), ...entries.filter(([, g]) => !g.virtual)]
    .map(([name, group]) => ({ name, group }))
})

// Per-group expand state in the sidebar (frontend-only).
const expandedGroups = ref<Set<string>>(new Set())
function toggleGroupExpand(name: string) {
  const s = new Set(expandedGroups.value)
  s.has(name) ? s.delete(name) : s.add(name)
  expandedGroups.value = s
}

// Member nodes of a group, resolved to display name (CENTER flagged).
function groupMemberInfo(name: string) {
  return (meshGroups.value[name]?.members || []).map((id: string) => {
    const n = graphData.value?.nodes?.find((nn: any) => nn.id === id)
    return { id, name: n?.data?.fileName || id.slice(0, 12), isCenter: !!n?.data?.isCenter }
  })
}

const selectedPeer = ref<string | null>(null)
const selectedEdge = ref<any>(null)
const selectedGroup = ref<string | null>(null)
const peerConfig = ref<any>(null)
const showCreateGroup = ref(false)
const newGroupName = ref('')
const createGroupError = ref('')
const showGlobalConfig = ref(false)
const showHealthCheck = ref(false)
const showHybridMesh = ref(false)
const traceSource = ref<string | null>(null)
const traceHighlight = ref<string[]>([])
const highlightDecl = ref<{ pub: string; priv: string } | null>(null)

// Context menu state
const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  type: null as 'node' | 'group' | 'connection' | null,
  targetId: '',
  headerName: '',
  headerSub: '',
  connSource: '',
  connTarget: '',
})

// Helper to build header info for a node
function nodeHeader(nodeId: string): { name: string; sub: string } {
  const node = graphData.value?.nodes?.find((n: any) => n.id === nodeId)?.data
  return {
    name: node?.fileName || nodeId.slice(0, 12),
    sub: node?.comments || '',
  }
}

const activePanel = computed(() => {
  // Tool panels (opened from the bottom-left) take priority and coexist with a
  // node/edge/group selection: the selection stays highlighted on the canvas
  // underneath, and closing the tool falls back to that selection's panel.
  if (showGlobalConfig.value) return 'global'
  if (showHealthCheck.value) return 'health'
  if (showHybridMesh.value) return 'hybrid'
  if (traceSource.value) return 'traceroute'
  if (selectedPeer.value) return 'peer'
  if (selectedEdge.value) return 'edge'
  if (selectedGroup.value) return 'group'
  return null
})

function clearSelection() {
  selectedPeer.value = null
  selectedEdge.value = null
  selectedGroup.value = null
  peerConfig.value = null
  showGlobalConfig.value = false
  showHealthCheck.value = false
  showHybridMesh.value = false
  traceSource.value = null
  traceHighlight.value = []
  highlightDecl.value = null
}

// Close only the tool panels (keep any node/edge/group selection so we fall
// back to its panel). Used by the bottom-left panels' close buttons.
function closeTool() {
  showGlobalConfig.value = false
  showHealthCheck.value = false
  showHybridMesh.value = false
  highlightDecl.value = null
}

// Toggle a bottom-left tool panel. Re-clicking the open tool closes it;
// opening one closes the other tools but PRESERVES the node/edge/group
// selection (so the node stays activated behind the tool panel).
function toggleTool(tool: 'global' | 'health' | 'hybrid') {
  closeSidebar()
  const wasOpen =
    tool === 'global' ? showGlobalConfig.value : tool === 'health' ? showHealthCheck.value : showHybridMesh.value
  showGlobalConfig.value = false
  showHealthCheck.value = false
  showHybridMesh.value = false
  highlightDecl.value = null
  if (wasOpen) return
  if (tool === 'global') showGlobalConfig.value = true
  else if (tool === 'health') showHealthCheck.value = true
  else showHybridMesh.value = true
}

// Jump from an Edit panel into the Hybrid Mesh panel, highlighting the
// declaration matching the given peer/connection.
function onGotoHybrid(payload: { pub?: string; priv?: string }) {
  clearSelection()
  highlightDecl.value = { pub: payload.pub || '', priv: payload.priv || '' }
  showHybridMesh.value = true
}

function selectGroup(name: string) {
  closeSidebar()
  if (selectedGroup.value === name) {
    clearSelection()
  } else {
    clearSelection()
    selectedGroup.value = name
  }
}

const anyToolOpen = () => showGlobalConfig.value || showHealthCheck.value || showHybridMesh.value

function onNodeClick(nodeId: string) {
  closeSidebar()
  // Re-click the active node with no tool covering it → deselect (toggle off).
  // If a tool panel is covering it, re-clicking reveals the node panel instead.
  if (selectedPeer.value === nodeId && !anyToolOpen()) {
    clearSelection()
    return
  }
  clearSelection()
  selectedPeer.value = nodeId
  const extra = graphData.value?.nodes?.find((n: any) => n.id === nodeId)?.data
  peerConfig.value = extra || {}
}

function onEdgeClick(edge: any) {
  if (selectedEdge.value?.id === edge.id && !anyToolOpen()) {
    clearSelection()
    return
  }
  clearSelection()
  selectedEdge.value = edge
}

function onNodeRightClick(event: { x: number; y: number; nodeId: string }) {
  clearSelection()
  selectedPeer.value = event.nodeId
  const extra = graphData.value?.nodes?.find((n: any) => n.id === event.nodeId)?.data
  peerConfig.value = extra || {}
  const h = nodeHeader(event.nodeId)
  contextMenu.visible = true
  contextMenu.x = event.x
  contextMenu.y = event.y
  contextMenu.type = 'node'
  contextMenu.targetId = event.nodeId
  contextMenu.headerName = h.name
  contextMenu.headerSub = h.sub
}

function onGroupRightClick(e: MouseEvent, groupName: string) {
  selectGroup(groupName)
  const g = meshGroups.value[groupName]
  contextMenu.visible = true
  contextMenu.x = e.clientX
  contextMenu.y = e.clientY
  contextMenu.type = 'group'
  contextMenu.targetId = groupName
  contextMenu.headerName = groupName
  contextMenu.headerSub = g?.comment || ''
}

// Group right-click from canvas (group frame)
function onCanvasGroupRightClick(event: { x: number; y: number; groupName: string }) {
  onGroupRightClick({ clientX: event.x, clientY: event.y } as MouseEvent, event.groupName)
}

// Edge right-click from canvas
function onEdgeRightClick(event: { x: number; y: number; edge: any }) {
  clearSelection()
  selectedEdge.value = event.edge
  const srcH = nodeHeader(event.edge.source)
  const tgtH = nodeHeader(event.edge.target)
  contextMenu.visible = true
  contextMenu.x = event.x
  contextMenu.y = event.y
  contextMenu.type = 'connection'
  contextMenu.targetId = event.edge.id
  contextMenu.headerName = srcH.name
  contextMenu.headerSub = tgtH.name
  contextMenu.connSource = srcH.name
  contextMenu.connTarget = tgtH.name
}

function closeContextMenu() {
  contextMenu.visible = false
}

function onStartTrace() {
  closeContextMenu()
  clearSelection()
  traceSource.value = contextMenu.targetId
}

function onTraceResult(hops: { nodeId: string }[]) {
  traceHighlight.value = hops.map(h => h.nodeId)
}

const selectionModal = reactive({
  visible: false,
  title: '',
  itemType: 'group' as 'node' | 'group',
  items: [] as any[],
  action: '' as 'add-to-group' | 'remove-from-group' | 'add-peer-to-group' | 'relay-for' | 'proxy-for',
})

function onAddToGroup() {
  closeContextMenu()
  const nodeId = contextMenu.targetId
  const nodeGroups = graphData.value?.nodes?.find((n: any) => n.id === nodeId)?.data?.groups || []
  const availableGroups = Object.entries(meshGroups.value)
    .filter(([name, g]: [string, any]) => !g.virtual && !nodeGroups.includes(name))
    .map(([name]: [string, any]) => ({ id: name, name, color: getGroupColor(name) }))

  selectionModal.visible = true
  selectionModal.title = 'Add to Group'
  selectionModal.itemType = 'group'
  selectionModal.items = availableGroups
  selectionModal.action = 'add-to-group'
}

function onRemoveFromGroup() {
  closeContextMenu()
  const nodeId = contextMenu.targetId
  const nodeGroups = graphData.value?.nodes?.find((n: any) => n.id === nodeId)?.data?.groups || []
  const memberGroups = nodeGroups
    .filter((name: string) => meshGroups.value[name] && !meshGroups.value[name].virtual)
    .map((name: string) => ({ id: name, name, color: getGroupColor(name) }))

  selectionModal.visible = true
  selectionModal.title = 'Remove from Group'
  selectionModal.itemType = 'group'
  selectionModal.items = memberGroups
  selectionModal.action = 'remove-from-group'
}

function onAddPeerToGroup() {
  closeContextMenu()
  const groupName = contextMenu.targetId
  const members = meshGroups.value[groupName]?.members || []
  const available = graphData.value?.nodes
    ?.filter((n: any) => !n.data?.isCenter && !members.includes(n.id))
    .map((n: any) => ({ id: n.id, name: n.data?.fileName || n.id.slice(0, 12), ipv4: '', comment: n.data?.comments || '' }))

  selectionModal.visible = true
  selectionModal.title = `Add Peer to ${groupName}`
  selectionModal.itemType = 'node'
  selectionModal.items = available || []
  selectionModal.action = 'add-peer-to-group'
}

function onSelectionSelect(id: string) {
  selectionModal.visible = false
  const nodeId = contextMenu.targetId
  if (selectionModal.action === 'add-to-group') {
    draftStore.addToGroup(id, nodeId)
  } else if (selectionModal.action === 'remove-from-group') {
    draftStore.removeFromGroup(id, nodeId)
  } else if (selectionModal.action === 'add-peer-to-group') {
    draftStore.addToGroup(nodeId, id) // here nodeId is the group name
  } else if (selectionModal.action === 'relay-for') {
    // nodeId (the peer) declares it relays `id` (the selected node)
    // PUBLIC=nodeId (high), PRIVATE=id (low)
    draftStore.addRelay(nodeId, id)
  } else if (selectionModal.action === 'proxy-for') {
    // nodeId (the peer) declares it NAT-proxies `id` (the selected node)
    // PUBLIC=nodeId (high), PRIVATE=id (low)
    draftStore.addProxy(nodeId, id)
  }
}

function onRelayFor() {
  closeContextMenu()
  const nodeId = contextMenu.targetId
  // Available: nodes that are not center, not self, and not already relayed by this node
  const node = graphData.value?.nodes?.find((n: any) => n.id === nodeId)
  const existingRelays = (node?.data?.relays || []).map((r: any) => r.id)
  const available = graphData.value?.nodes
    ?.filter((n: any) => !n.data?.isCenter && n.id !== nodeId && !existingRelays.includes(n.id))
    .map((n: any) => ({ id: n.id, name: n.data?.fileName || n.id.slice(0, 12), comment: n.data?.comments || '' }))
  selectionModal.visible = true
  selectionModal.title = 'Relay for…'
  selectionModal.itemType = 'node'
  selectionModal.items = available || []
  selectionModal.action = 'relay-for'
}

function onProxyFor() {
  closeContextMenu()
  const nodeId = contextMenu.targetId
  // Available: nodes that are not center, not self, and not already proxied by this node
  const node = graphData.value?.nodes?.find((n: any) => n.id === nodeId)
  const existingProxies = (node?.data?.proxies || []).map((r: any) => r.id)
  const available = graphData.value?.nodes
    ?.filter((n: any) => !n.data?.isCenter && n.id !== nodeId && !existingProxies.includes(n.id))
    .map((n: any) => ({ id: n.id, name: n.data?.fileName || n.id.slice(0, 12), comment: n.data?.comments || '' }))
  selectionModal.visible = true
  selectionModal.title = 'Proxy for…'
  selectionModal.itemType = 'node'
  selectionModal.items = available || []
  selectionModal.action = 'proxy-for'
}

function onSetGateway() {
  closeContextMenu()
  const edge = selectedEdge.value
  if (edge) {
    // edge.source=B (low), edge.target=A (high exit). GATEWAY: PUBLIC=A, PRIVATE=B.
    draftStore.addGateway(edge.target, edge.source)
  }
}

function onSetDefault() {
  closeContextMenu()
  const edge = selectedEdge.value
  if (edge) {
    // Clear both the manual P2P_CONFIG AND any high-level GATEWAY declaration
    // for this edge (edge.source treats edge.target as gateway →
    // GATEWAY{PUBLIC: target, PRIVATE: source}). Otherwise the gateway intent
    // re-renders the P2P_CONFIG and "Set As Default" appears to do nothing.
    draftStore.resetP2P(edge.source, edge.target)
    draftStore.removeGateway(edge.target, edge.source)
    selectedEdge.value = null
  }
}

function onContextMenuDeleteGroup() {
  closeContextMenu()
  const name = contextMenu.targetId
  if (confirm(`Delete group "${name}"?`)) {
    draftStore.deleteGroup(name)
    if (selectedGroup.value === name) selectedGroup.value = null
  }
}

function createGroup() {
  const name = newGroupName.value.trim()
  createGroupError.value = ''
  if (!name) { createGroupError.value = 'Name required'; return }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) { createGroupError.value = 'Only letters, digits, _ and -'; return }
  if (meshGroups.value[name]) { createGroupError.value = 'Group already exists'; return }
  draftStore.createGroup(name, [])
  newGroupName.value = ''
  showCreateGroup.value = false
}

// --- Edits: mutate draft only (graph recomputes live, nothing persisted) ---
function savePeer(pubkey: string, data: any) {
  draftStore.upsertPeer(pubkey, data)
  selectedPeer.value = null
}

function saveEdge(source: string, target: string, data: any) {
  draftStore.upsertP2P(source, target, data)
  selectedEdge.value = null
}

function resetEdge(source: string, target: string) {
  draftStore.resetP2P(source, target)
  selectedEdge.value = null
}

function saveGlobalConfig(data: any) {
  draftStore.updateGlobal(data)
  showGlobalConfig.value = false
}

// Health check badge: quick (static) error count for the sidebar.
const conflictCount = computed(() => {
  if (!graphData.value) return 0
  try {
    const q = new EasyWGSyncModel(graphData.value).quickCheck()
    return q.gatewayUniqueness.length + q.relayUniqueness.length + q.connectionErrors.length
  } catch { return 0 }
})

// Group panel mutates the draft directly; just close on done.
function onPanelSaved() {
  clearSelection()
}

async function saveAll() {
  await draftStore.commit()
  previewOpen.value = false
}

function discardAll() {
  draftStore.discard()
  previewOpen.value = false
}

onMounted(() => draftStore.load())
</script>
