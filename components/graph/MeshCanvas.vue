<template>
  <VueFlow
    ref="flowRef"
    :nodes="frozenNodes"
    :edges="frozenEdges"
    :default-viewport="{ zoom: 0.55 }"
    :min-zoom="0.2"
    :connection-mode="ConnectionMode.Loose"
    :snap-to-grid="false"
    class="w-full h-full bg-background"
    :class="{ 'debug-clickzones': debug }"
    @node-click="onNodeClick"
    @edge-click="onEdgeClick"
    @node-drag-stop="onNodeDragStop"
    @nodes-initialized="onNodesReady"
  >
    <Background :gap="24" :size="1" pattern-color="hsl(0 0% 12%)" />
    <Controls position="bottom-right" />
    <MiniMap position="bottom-left" :node-color="miniMapNodeColor" />

    <div v-if="debug" class="absolute top-2 left-2 z-50 bg-card border border-border rounded-md px-3 py-2 text-[11px] space-y-1 pointer-events-none">
      <div class="font-medium text-foreground mb-1">点击命中区 (D 切换)</div>
      <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-sm" style="background: rgba(59,130,246,0.25); outline: 1px solid #3b82f6" /> Node (可点击)</div>
      <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-sm" style="background: rgba(239,68,68,0.25); outline: 1px solid #ef4444" /> Edge 命中区 (20px)</div>
      <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-sm" style="outline: 1px dashed #9ca3af" /> Group (不可点击)</div>
    </div>

    <template #node-peer="nodeProps">
      <PeerNode :data="nodeProps.data" />
    </template>

    <template #node-group="nodeProps">
      <GroupNode :data="nodeProps.data" />
    </template>
  </VueFlow>
</template>

<script setup lang="ts">
import { VueFlow, ConnectionMode, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { buildVueFlowElements, computeGroupBoxes } from '~/composables/useMeshGraph'

const props = defineProps<{
  data: any
  selectedGroup?: string | null
  selectedNode?: string | null
  selectedEdge?: { source: string; target: string } | null
  tracePath?: string[]
}>()

const emit = defineEmits<{
  'node-click': [nodeId: string]
  'edge-click': [edge: any]
  'node-right-click': [event: { x: number; y: number; nodeId: string }]
  'edge-right-click': [event: { x: number; y: number; edge: any }]
  'group-right-click': [event: { x: number; y: number; groupName: string }]
}>()

// Debug: visualize click hit-zones (toggle with 'D')
const debug = ref(false)
function onDebugKey(e: KeyboardEvent) {
  if (e.key !== 'd' && e.key !== 'D') return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  debug.value = !debug.value
}

const { getNodes, setNodes, getEdges, setEdges } = useVueFlow()

// User-dragged node positions (persisted to localStorage, applied after layout).
const nodePositions = useNodePositions()
nodePositions.hydrate()

const initialized = ref(false)

// Compute elements (only used for initial render and edge recalc)
const elements = computed(() => {
  if (!props.data) return { nodes: [], edges: [] }
  return buildVueFlowElements(props.data, {
    selectedGroup: props.selectedGroup || null,
    selectedNode: props.selectedNode || null,
    selectedEdge: props.selectedEdge || null,
  })
})

// Freeze initial nodes - only set once, never update via prop binding
const frozenNodes = shallowRef<any[]>([])
const frozenEdges = shallowRef<any[]>([])

watch(elements, (val) => {
  if (!initialized.value && val.nodes.length > 0) {
    // Lay out normally, then move any node the user has dragged before to its
    // cached position.
    frozenNodes.value = nodePositions.applyTo(val.nodes)
    frozenEdges.value = val.edges
  }
}, { immediate: true })

// When graphData changes (draft edits: toggle enabled, add/remove members, relay
// declarations, etc.), update node data + edges + group boxes without resetting positions.
watch(() => props.data, () => {
  if (!initialized.value) return
  nextTick(() => {
    const newElements = elements.value
    // Update node data (relays, groups, displayName, etc.) on existing nodes
    // without changing positions — keeps user-dragged layout intact.
    const currentNodes = getNodes.value
    for (const newNode of newElements.nodes) {
      const existing = currentNodes.find(n => n.id === newNode.id)
      if (existing && existing.type === 'peer') {
        existing.data = { ...newNode.data }
      }
    }
    // Update edges (handles added/removed connections from relay/gateway/mesh changes)
    setEdges(newElements.edges)
    recalcAll()
  })
}, { deep: true })

// When viewState changes (selection), update node data without resetting positions
watch([() => props.selectedGroup, () => props.selectedNode, () => props.selectedEdge], () => {
  if (!initialized.value) return
  const currentNodes = getNodes.value
  const newElements = elements.value

  for (const newNode of newElements.nodes) {
    const existing = currentNodes.find(n => n.id === newNode.id)
    if (existing && existing.type === 'peer') {
      existing.data = { ...newNode.data }
    }
  }

  // Also update edges (dimming)
  nextTick(() => recalcAll())
}, { deep: false })

function onNodeClick({ node }: any) {
  if (node.type === 'peer') {
    emit('node-click', node.id)
  }
}

function onEdgeClick({ edge }: any) {
  emit('edge-click', { ...edge, data: edge.data })
}

// Expose right-click on canvas node / edge / group
onMounted(() => {
  const el = document.querySelector('.vue-flow')
  if (el) {
    el.addEventListener('contextmenu', (e: any) => {
      // Edge click target: Vue Flow renders edges as <path> inside .vue-flow__edges
      const edgeEl = (e.target as HTMLElement).closest('.vue-flow__edge')
      if (edgeEl) {
        const edgeId = edgeEl.getAttribute('data-id')
        if (edgeId) {
          const edge = getEdges.value.find((ed: any) => ed.id === edgeId)
          if (edge) {
            e.preventDefault()
            emit('edge-right-click', { x: e.clientX, y: e.clientY, edge })
          }
        }
        return
      }

      // Node / group click target
      const nodeEl = (e.target as HTMLElement).closest('[data-id]')
      if (nodeEl) {
        const nodeId = nodeEl.getAttribute('data-id')
        if (nodeId) {
          e.preventDefault()
          if (nodeId.startsWith('group-')) {
            const groupName = nodeId.replace(/^group-/, '')
            emit('group-right-click', { x: e.clientX, y: e.clientY, groupName })
          } else {
            emit('node-right-click', { x: e.clientX, y: e.clientY, nodeId })
          }
        }
      }
    })
  }

  // Listen for theme changes to repaint colors
  window.addEventListener('theme-changed', () => {
    nextTick(() => recalcAll())
  })

  // Debug hit-zone toggle
  window.addEventListener('keydown', onDebugKey)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onDebugKey)
})

function onNodeDragStop({ node }: any) {
  // Persist the dragged peer's new position (groups are derived boxes, skip).
  if (node?.type === 'peer' && node.position) {
    nodePositions.set(node.id, node.position)
  }
  nextTick(() => recalcAll())
}

function onNodesReady() {
  initialized.value = true
  setTimeout(() => recalcAll(), 200)
}

// "Reset All Positions": drop the cached layout and move every peer node back to
// its freshly-computed default position, then rebuild group boxes + edges.
watch(() => nodePositions.resetTick.value, () => {
  if (!initialized.value) return
  const layout = elements.value
  const current = getNodes.value
  const peers = layout.nodes
    .filter(ln => ln.type === 'peer')
    .map((ln) => {
      const ex = current.find(n => n.id === ln.id)
      return ex ? { ...ex, position: { ...ln.position } } : ln
    })
  setNodes(peers)
  nextTick(() => recalcAll())
})

// Single unified recalc: reads real positions + dimensions from DOM, updates groups + edges
function recalcAll() {
  const allNodes = getNodes.value
  if (!allNodes || allNodes.length === 0) return

  const currentPositions = new Map<string, { x: number; y: number }>()
  const currentDimensions = new Map<string, { width: number; height: number }>()
  const groupBoxPositions = new Map<string, { x: number; y: number; width: number; height: number }>()

  for (const n of allNodes) {
    if (n.type !== 'peer') continue
    const w = n.dimensions?.width || 450
    const h = n.dimensions?.height || 160
    currentPositions.set(n.id, { x: n.position.x, y: n.position.y })
    currentDimensions.set(n.id, { width: w, height: h })
    groupBoxPositions.set(n.id, { x: n.position.x, y: n.position.y, width: w, height: h })
  }

  // Recompute group boxes
  const newGroupNodes = computeGroupBoxes(
    props.data.meshGroups,
    groupBoxPositions,
    { selectedGroup: props.selectedGroup || null, selectedNode: props.selectedNode || null, selectedEdge: props.selectedEdge || null }
  )
  const peerNodes = allNodes.filter(n => n.type === 'peer')
  setNodes([...peerNodes, ...newGroupNodes])

  // Recompute edges with real positions and dimensions
  const newElements = buildVueFlowElements(props.data, {
    selectedGroup: props.selectedGroup || null,
    selectedNode: props.selectedNode || null,
    selectedEdge: props.selectedEdge || null,
  }, currentPositions, currentDimensions)
  setEdges(newElements.edges)
}

// Recompute when selectedGroup or selectedNode changes
watch([() => props.selectedGroup, () => props.selectedNode, () => props.selectedEdge], () => {
  nextTick(() => recalcAll())
})

// Watch tracePath: highlight path nodes and directed edges
watch(() => props.tracePath, (path) => {
  if (!initialized.value) return
  const currentNodes = getNodes.value
  const pathSet = new Set(path || [])
  const hasPath = pathSet.size > 0

  // Build directed edge pairs from path
  const pathEdges = new Set<string>()
  if (path && path.length > 1) {
    for (let i = 0; i < path.length - 1; i++) {
      pathEdges.add(`${path[i]}->${path[i + 1]}`)
    }
  }

  // Update node data
  for (const node of currentNodes) {
    if (node.type !== 'peer') continue
    if (hasPath) {
      node.data = { ...node.data, selected: pathSet.has(node.id), dimmed: !pathSet.has(node.id) }
    }
  }

  // Update edges
  if (hasPath) {
    const isDark = document.documentElement.classList.contains('dark')
    const highlightColor = isDark ? '#ffffff' : '#000000'
    const currentEdges = getEdges.value
    for (const edge of currentEdges) {
      const isOnPath = pathEdges.has(`${edge.source}->${edge.target}`)
      const existingStroke = (edge.style as any)?.stroke || ''
      edge.style = {
        ...edge.style,
        stroke: isOnPath ? highlightColor : existingStroke,
        strokeWidth: isOnPath ? 3 : 1,
        opacity: isOnPath ? 1 : 0.1,
        filter: isOnPath ? `drop-shadow(0 0 4px ${highlightColor}99)` : undefined,
      } as any
      edge.markerEnd = {
        type: 'arrowclosed',
        color: isOnPath ? highlightColor : existingStroke,
      } as any
    }
  }
}, { deep: true })

function miniMapNodeColor(node: any) {
  return node.type === 'group' ? 'transparent' : 'hsl(0 0% 50%)'
}
</script>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';
@import '@vue-flow/minimap/dist/style.css';

.vue-flow {
  --vf-node-bg: transparent;
  --vf-node-color: hsl(0 0% 98%);
}

.vue-flow__minimap {
  background-color: hsl(var(--card)) !important;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
}

.vue-flow__minimap-mask {
  fill: hsl(var(--foreground));
  fill-opacity: 0.1;
}

.vue-flow__controls {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  overflow: hidden;
}

.vue-flow__controls-button {
  background: transparent;
  border-bottom-color: hsl(var(--border));
  color: hsl(var(--muted-foreground));
  fill: hsl(var(--muted-foreground));
}

.vue-flow__controls-button:hover {
  background: hsl(var(--secondary));
  color: hsl(var(--foreground));
  fill: hsl(var(--foreground));
}

.vue-flow__edge-path {
  stroke-linecap: round;
}

.vue-flow__edge {
  pointer-events: all;
  cursor: pointer;
}

.vue-flow__edge-interaction,
.vue-flow__edge-path {
  /* Only the stroke band should capture clicks, not the implicit fill area
     of the open bezier path (otherwise a curve's "belly" steals clicks from
     nearby edges that visually pass through it). */
  pointer-events: stroke;
  fill: none;
}

.vue-flow__edge-interaction {
  stroke-width: 20px;
}

.vue-flow__node {
  border: none !important;
  box-shadow: none !important;
  background: none !important;
  padding: 0 !important;
}

/* === Debug: visualize click hit-zones === */
/* Edge interaction path (the actual clickable stroke band) */
.debug-clickzones .vue-flow__edge-interaction {
  stroke: #ef4444 !important;
  stroke-opacity: 0.25 !important;
}
/* Node clickable area */
.debug-clickzones .vue-flow__node-peer .peer-node {
  outline: 1px solid #3b82f6;
  background: rgba(59, 130, 246, 0.12) !important;
}
/* Group frame (pointer-events: none → not clickable) */
.debug-clickzones .vue-flow__node-group .group-node {
  outline: 1px dashed #9ca3af;
}
</style>
