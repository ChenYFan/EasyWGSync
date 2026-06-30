import type { Node, Edge } from '@vue-flow/core'
import { ref } from 'vue'

const DARK_COLORS = ['#5271ff', '#8c52ff', '#b174e7', '#cb6ce6', '#ff66c4', '#ff5050', '#ff5757', '#ff914d', '#ffbd59', '#ffde59', '#c1ff72', '#99e17a', '#5cffb0', '#69f2c4', '#5ce1e6', '#5ce7ff', '#70cbff', '#5ca3ff', '#99acff', '#bea1f7', '#cea8f0', '#e1a8f0', '#ff99d8', '#ffadad', '#ff9999', '#ffc099', '#ffd699', '#ffeb99', '#d3ff99', '#bfecac', '#99ffce', '#a1f7da', '#a7eff1', '#99f0ff', '#99daff', '#99c5ff', '#1f48ff', '#5e17eb', '#9440dd', '#bc3fde', '#ff1fa9', '#ff3a3a', '#ff3131', '#ff751f', '#ffa51f', '#ffd21f', '#9eff1f', '#7ed957', '#1fff93', '#31edae', '#3ddbe1', '#0cc0df', '#38b6ff', '#1f80ff']
const LIGHT_COLORS = ['#0025cc', '#4910bc', '#6b1fad', '#8f1eae', '#cc007e', '#ff2828', '#cc0000', '#cc4e00', '#cc7a00', '#cca300', '#74cc00', '#4ca626', '#00bf63', '#10bb82', '#1cabb0', '#0097b2', '#0081cc', '#004aad', '#00167a', '#2c0a71', '#401268', '#561269', '#7a004b', '#661414', '#7a0000', '#7a2f00', '#7a4900', '#7a6200', '#457a00', '#2e6417', '#007a3f', '#0a714e', '#11676a', '#00687a', '#004e7a', '#00357a', '#1f48ff', '#5e17eb', '#9440dd', '#bc3fde', '#ff1fa9', '#ff3a3a', '#ff3131', '#ff751f', '#ffa51f', '#ffd21f', '#9eff1f', '#7ed957', '#1fff93', '#31edae', '#3ddbe1', '#0cc0df', '#38b6ff', '#1f80ff']
// Reactive dark mode state (updated by theme-changed event)
export const isDarkMode = ref(typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true)

if (typeof window !== 'undefined') {
  window.addEventListener('theme-changed', () => {
    isDarkMode.value = document.documentElement.classList.contains('dark')
  })
}

// Ordered color assignment: real groups take palette indices in first-sight
// order (module-singleton → stable within a session). CENTER/ORPHAN excluded.
const groupColorIndex = new Map<string, number>()
let nextGroupColor = 0

export function getGroupColor(groupName: string): string {
  if (groupName === 'CENTER_GROUP') {
    return isDarkMode.value ? '#ffffff' : '#000000'
  }
  if (groupName === 'ORPHAN_GROUP') return '#6b7280'
  // Assign palette colors in order: each real group, on first sight, takes the
  // next index. Palettes are gradient-ordered (first 18 = maximally distinct
  // hues), so consecutive groups get distinct hues — no hashing/collisions.
  // Light/dark mode pick from their own shade set.
  let idx = groupColorIndex.get(groupName)
  if (idx === undefined) {
    idx = nextGroupColor++
    groupColorIndex.set(groupName, idx)
  }
  const palette = isDarkMode.value ? DARK_COLORS : LIGHT_COLORS
  return palette[idx % palette.length]
}

export function shortenKey(pubkey: string): string {
  if (!pubkey) return '?'
  return pubkey.slice(0, 8) + '...'
}

interface GraphData {
  nodes: any[]
  edges: any[]
  meshGroups: Record<string, { members: string[]; comment: string; virtual: boolean }>
}

interface ViewState {
  selectedGroup: string | null
  selectedNode: string | null
  selectedEdge: { source: string; target: string } | null
}

export type VisualState = 'selected' | 'semi' | 'normal' | 'dimmed'

// Opacity per visual state, per object kind.
const NODE_OPACITY: Record<VisualState, number> = { selected: 1, semi: 0.6, normal: 1, dimmed: 0.1 }
const EDGE_OPACITY: Record<VisualState, number> = { selected: 1, semi: 0.6, normal: 1, dimmed: 0.1 }
const GROUP_OPACITY: Record<VisualState, number> = { selected: 1, semi: 0.4, normal: 0.1, dimmed: 0.01 }

// z-index priority: first by selection state, then by kind (node > edge > group).
const STATE_RANK: Record<VisualState, number> = { selected: 3, semi: 2, normal: 1, dimmed: 0 }
const KIND_RANK = { node: 30, edge: 20, group: 10 }
function zIndexFor(state: VisualState, kind: keyof typeof KIND_RANK): number {
  return STATE_RANK[state] * 100 + KIND_RANK[kind]
}

// Compute visual state for nodes / edges / groups given the current selection.
// When nothing is selected, everything is 'normal'.
function computeStates(data: GraphData, viewState: ViewState) {
  const nodeState = new Map<string, VisualState>()
  const edgeState = new Map<string, VisualState>()
  const groupState = new Map<string, VisualState>()

  const hasSelection = !!(viewState.selectedGroup || viewState.selectedNode || viewState.selectedEdge)

  for (const n of data.nodes) nodeState.set(n.id, hasSelection ? 'dimmed' : 'normal')
  for (const e of data.edges) edgeState.set(`${e.source}->${e.target}`, hasSelection ? 'dimmed' : 'normal')
  for (const g of Object.keys(data.meshGroups)) groupState.set(g, hasSelection ? 'dimmed' : 'normal')

  if (viewState.selectedNode) {
    const sel = viewState.selectedNode
    nodeState.set(sel, 'selected')
    for (const e of data.edges) {
      if (e.source === sel || e.target === sel) {
        edgeState.set(`${e.source}->${e.target}`, 'semi')
        const neighbor = e.source === sel ? e.target : e.source
        if (nodeState.get(neighbor) !== 'selected') nodeState.set(neighbor, 'semi')
      }
    }
    // Groups the selected node belongs to => semi
    for (const [g, grp] of Object.entries(data.meshGroups)) {
      if (grp.members.includes(sel)) groupState.set(g, 'semi')
    }
  } else if (viewState.selectedEdge) {
    const { source, target } = viewState.selectedEdge
    edgeState.set(`${source}->${target}`, 'selected')
    edgeState.set(`${target}->${source}`, 'semi')
    nodeState.set(source, 'selected')
    nodeState.set(target, 'selected')
    // Groups containing both endpoints => semi
    for (const [g, grp] of Object.entries(data.meshGroups)) {
      if (grp.members.includes(source) && grp.members.includes(target)) groupState.set(g, 'semi')
    }
  } else if (viewState.selectedGroup) {
    const members = new Set(data.meshGroups[viewState.selectedGroup]?.members || [])
    groupState.set(viewState.selectedGroup, 'selected')
    for (const id of members) nodeState.set(id, 'semi')
    for (const e of data.edges) {
      if (members.has(e.source) && members.has(e.target)) {
        edgeState.set(`${e.source}->${e.target}`, 'semi')
      }
    }
  }

  return { nodeState, edgeState, groupState, hasSelection }
}

const GROUP_PADDING = 50

export function computeGroupBoxes(
  meshGroups: Record<string, { members: string[]; comment: string; virtual: boolean }>,
  nodePositions: Map<string, { x: number; y: number; width: number; height: number }>,
  viewState: ViewState
): Node[] {
  const groupNodes: Node[] = []

  // Compute group states (need a data-like shape for computeStates)
  const fakeData = {
    nodes: [...nodePositions.keys()].map(id => ({ id, data: {} })),
    edges: [],
    meshGroups,
  } as any
  const { groupState } = computeStates(fakeData, viewState)

  for (const [groupName, group] of Object.entries(meshGroups)) {
    if (!group || group.members.length === 0) continue

    const memberRects = group.members
      .map(id => nodePositions.get(id))
      .filter(Boolean) as { x: number; y: number; width: number; height: number }[]

    if (memberRects.length === 0) continue

    const minX = Math.min(...memberRects.map(r => r.x)) - GROUP_PADDING
    const minY = Math.min(...memberRects.map(r => r.y)) - GROUP_PADDING - 28
    const maxX = Math.max(...memberRects.map(r => r.x + r.width)) + GROUP_PADDING
    const maxY = Math.max(...memberRects.map(r => r.y + r.height)) + GROUP_PADDING

    const state = groupState.get(groupName) || 'normal'
    const isActive = state === 'selected'
    const gopacity = GROUP_OPACITY[state]

    groupNodes.push({
      id: `group-${groupName}`,
      type: 'group',
      position: { x: minX, y: minY },
      data: {
        label: groupName,
        color: getGroupColor(groupName),
        memberCount: group.members.length,
        isActive,
        gopacity,
        vstate: state,
      },
      style: {
        width: `${maxX - minX}px`,
        height: `${maxY - minY}px`,
        pointerEvents: 'none',
      },
      zIndex: zIndexFor(state, 'group'),
      selectable: false,
      draggable: false,
      focusable: false,
      connectable: false,
    })
  }

  return groupNodes
}

// Cache layout positions - only recalculate when graph data changes
let cachedLayoutKey = ''
let cachedPositions = new Map<string, { x: number; y: number }>()

export function buildVueFlowElements(
  data: GraphData,
  viewState: ViewState = { selectedGroup: null, selectedNode: null, selectedEdge: null },
  overridePositions?: Map<string, { x: number; y: number }>,
  nodeDimensions?: Map<string, { width: number; height: number }>
) {
  const vfNodes: Node[] = []
  const vfEdges: Edge[] = []

  // Only re-run layout when node set changes (and no override positions)
  const layoutKey = data.nodes.map(n => n.id).sort().join(',')
  if (layoutKey !== cachedLayoutKey) {
    cachedLayoutKey = layoutKey
    cachedPositions = forceLayout(data.nodes, data.edges)
  }
  const positions = overridePositions || cachedPositions

  // Unified visual states for nodes / edges / groups
  const { nodeState, edgeState } = computeStates(data, viewState)

  const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>()

  for (const node of data.nodes) {
    const pos = positions.get(node.id) || { x: 0, y: 0 }
    const displayName = node.data.fileName || shortenKey(node.data.publicKey)

    const state = nodeState.get(node.id) || 'normal'
    const selected = state === 'selected'
    const opacity = NODE_OPACITY[state]

    const estimatedWidth = 500
    const estimatedHeight = 200

    nodePositions.set(node.id, { ...pos, width: estimatedWidth, height: estimatedHeight })

    vfNodes.push({
      id: node.id,
      type: 'peer',
      position: pos,
      data: { ...node.data, displayName, selected, vstate: state, vopacity: opacity },
      zIndex: zIndexFor(state, 'node'),
    })
  }

  const groupNodes = computeGroupBoxes(data.meshGroups, nodePositions, viewState)
  vfNodes.push(...groupNodes)

  //
  // Edge click hit-detection fix: Vue Flow's edge-interaction SVG path
  // implicitly closes into a fill region, stealing clicks from nearby
  // reverse-direction edges. Fixed via CSS pointer-events: stroke + fill: none.
  //
  // Step 0: compute absolute positions for each handle on each node.
  const handleAbsPos = new Map<string, Map<string, { x: number; y: number }>>()
  for (const node of data.nodes) {
    const pos = positions.get(node.id) || { x: 0, y: 0 }
    const dims = nodeDimensions?.get(node.id) || { width: 450, height: 160 }
    const map = new Map<string, { x: number; y: number }>()
    for (const hp of HANDLE_POINTS) {
      map.set(hp.id, { x: pos.x + hp.rx * dims.width, y: pos.y + hp.ry * dims.height })
    }
    handleAbsPos.set(node.id, map)
  }

  const getNodeW = (id: string) => nodeDimensions?.get(id)?.width || 450
  const getNodeH = (id: string) => nodeDimensions?.get(id)?.height || 160

  const handleUsage = new Map<string, number>()
  const pairHistory = new Map<string, { srcH: string; tgtH: string }>()

  for (const edge of data.edges) {
    const estate = edgeState.get(`${edge.source}->${edge.target}`) || 'normal'
    const dimmed = estate === 'dimmed'
    const eopacity = EDGE_OPACITY[estate]

    const srcPos = positions.get(edge.source) || { x: 0, y: 0 }
    const tgtPos = positions.get(edge.target) || { x: 0, y: 0 }

    // Step 1: determine valid sides, get candidate handles.
    const srcCandidates = getCandidateHandles(getValidSides(srcPos, tgtPos))
    const tgtCandidates = getCandidateHandles(getValidSides(tgtPos, srcPos))

    const srcAbsMap = handleAbsPos.get(edge.source)!
    const tgtAbsMap = handleAbsPos.get(edge.target)!

    // Step 5: check for existing A-B pair → anti-cross direction reward.
    const pairKey = [edge.source, edge.target].sort().join('|')
    const existingPair = pairHistory.get(pairKey)

    let srcHandle: string
    let tgtHandle: string

    if (!existingPair) {
      // First edge: pure distance selection.
      let bestDist = Infinity
      srcHandle = srcCandidates[0]?.id || HANDLE_POINTS[0].id
      tgtHandle = tgtCandidates[0]?.id || HANDLE_POINTS[0].id

      for (const sh of srcCandidates) {
        const sPos = srcAbsMap.get(sh.id)!
        const srcUsed = handleUsage.get(`${edge.source}:${sh.id}`) || 0
        const srcPenalty = sh.penalty * Math.pow(1.4, srcUsed)

        for (const th of tgtCandidates) {
          const tPos = tgtAbsMap.get(th.id)!
          const tgtUsed = handleUsage.get(`${edge.target}:${th.id}`) || 0
          const tgtPenalty = th.penalty * Math.pow(1.4, tgtUsed)

          // Step 4: raw distance × penalties
          const rawDist = Math.sqrt((sPos.x - tPos.x) ** 2 + (sPos.y - tPos.y) ** 2)
          const dist = rawDist * srcPenalty * tgtPenalty

          if (dist < bestDist) {
            bestDist = dist
            srcHandle = sh.id
            tgtHandle = th.id
          }
        }
      }

      pairHistory.set(pairKey, { srcH: srcHandle, tgtH: tgtHandle })
    } else {
      // Second (reverse) edge: apply anti-cross direction reward.
      const isForward = edge.source === [edge.source, edge.target].sort()[0]
      const prevOnSrc = isForward ? existingPair.srcH : existingPair.tgtH
      const prevOnTgt = isForward ? existingPair.tgtH : existingPair.srcH

      const prevSrcPoint = HANDLE_POINTS.find(c => c.id === prevOnSrc)
      const prevTgtPoint = HANDLE_POINTS.find(c => c.id === prevOnTgt)

      // First pass: normal distance to get initial A-n.
      let bestDist = Infinity
      srcHandle = srcCandidates[0]?.id || HANDLE_POINTS[0].id
      tgtHandle = tgtCandidates[0]?.id || HANDLE_POINTS[0].id

      for (const sh of srcCandidates) {
        const sPos = srcAbsMap.get(sh.id)!
        const srcUsed = handleUsage.get(`${edge.source}:${sh.id}`) || 0
        const srcPenalty = sh.penalty * Math.pow(1.4, srcUsed)
        for (const th of tgtCandidates) {
          const tPos = tgtAbsMap.get(th.id)!
          const tgtUsed = handleUsage.get(`${edge.target}:${th.id}`) || 0
          const tgtPenalty = th.penalty * Math.pow(1.4, tgtUsed)
          const rawDist = Math.sqrt((sPos.x - tPos.x) ** 2 + (sPos.y - tPos.y) ** 2)
          const dist = rawDist * srcPenalty * tgtPenalty
          if (dist < bestDist) {
            bestDist = dist
            srcHandle = sh.id
            tgtHandle = th.id
          }
        }
      }

      // Determine direction: A-n CW or CCW from A-1? cwIndex diff.
      let direction = 0 // +1 = CW, -1 = CCW
      if (prevSrcPoint) {
        const curSrcPoint = HANDLE_POINTS.find(c => c.id === srcHandle)
        if (curSrcPoint && curSrcPoint.cwIndex !== prevSrcPoint.cwIndex) {
          const diff = curSrcPoint.cwIndex - prevSrcPoint.cwIndex
          // Handle wrap: if diff > 8, it's actually CCW; if diff < -8, it's actually CW
          if (diff > 0 && diff <= 8) direction = 1
          else if (diff < 0 && diff >= -8) direction = -1
          else if (diff > 8) direction = -1
          else if (diff < -8) direction = 1
        }
      }

      // Second pass: re-run with direction reward on B's opposite-direction handles.
      if (direction !== 0 && prevTgtPoint) {
        bestDist = Infinity
        for (const sh of srcCandidates) {
          const sPos = srcAbsMap.get(sh.id)!
          const srcUsed = handleUsage.get(`${edge.source}:${sh.id}`) || 0
          const srcPenalty = sh.penalty * Math.pow(1.4, srcUsed)
          for (const th of tgtCandidates) {
            const tPos = tgtAbsMap.get(th.id)!
            const tgtUsed = handleUsage.get(`${edge.target}:${th.id}`) || 0
            let tgtPenalty = th.penalty * Math.pow(1.4, tgtUsed)

            // B candidates in opposite direction from A-n get reward ×0.72.
            const tgtDiff = th.cwIndex - prevTgtPoint.cwIndex
            let tgtDir = 0
            if (tgtDiff > 0 && tgtDiff <= 8) tgtDir = 1
            else if (tgtDiff < 0 && tgtDiff >= -8) tgtDir = -1
            else if (tgtDiff > 8) tgtDir = -1
            else if (tgtDiff < -8) tgtDir = 1

            // Direction reward: B candidates in OPPOSITE direction get x0.72
            if (tgtDir !== 0 && tgtDir !== direction) {
              tgtPenalty *= 0.72
            }

            const rawDist = Math.sqrt((sPos.x - tPos.x) ** 2 + (sPos.y - tPos.y) ** 2)
            const dist = rawDist * srcPenalty * tgtPenalty
            if (dist < bestDist) {
              bestDist = dist
              srcHandle = sh.id
              tgtHandle = th.id
            }
          }
        }
      }
    }

    handleUsage.set(`${edge.source}:${srcHandle}`, (handleUsage.get(`${edge.source}:${srcHandle}`) || 0) + 1)
    handleUsage.set(`${edge.target}:${tgtHandle}`, (handleUsage.get(`${edge.target}:${tgtHandle}`) || 0) + 1)

    const color = getGroupColor(edge.data.primaryGroup || '')
    const hasP2PConfig = !!edge.data.hasP2PConfig

    // Dashed if no P2P config (default connection).
    const isDashed = !hasP2PConfig

    const isSelectedEdge = viewState.selectedEdge &&
      edge.source === viewState.selectedEdge.source &&
      edge.target === viewState.selectedEdge.target

    // Selected edge color follows theme.
    const selectedColor = typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? '#ffffff' : '#000000'

    vfEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: srcHandle,
      targetHandle: tgtHandle,
      type: 'default',
      data: edge.data,
      label: edge.data?.isGateway ? 'GW' : undefined,
      labelStyle: { fill: '#a855f7', fontWeight: 600, fontSize: 9, opacity: eopacity },
      labelBgStyle: { fill: 'hsl(var(--card))', opacity: eopacity },
      style: {
        stroke: isSelectedEdge ? selectedColor : color,
        strokeWidth: isSelectedEdge ? 3 : (estate === 'semi' ? 2 : (dimmed ? 1 : 2)),
        opacity: eopacity,
        strokeDasharray: isDashed ? '8 4' : undefined,
        filter: isSelectedEdge ? `drop-shadow(0 0 4px ${selectedColor}99)` : undefined,
      },
      markerEnd: { type: 'arrowclosed' as any, color: isSelectedEdge ? selectedColor : color },
    })
  }

  return { nodes: vfNodes, edges: vfEdges }
}

function getFacingSide(aPos: { x: number; y: number }, bPos: { x: number; y: number }): string {
  const nodeW = 450, nodeH = 160
  const aCx = aPos.x + nodeW / 2
  const aCy = aPos.y + nodeH / 2
  const bCx = bPos.x + nodeW / 2
  const bCy = bPos.y + nodeH / 2

  const dx = bCx - aCx
  const dy = bCy - aCy

  if (Math.abs(dx) * nodeH > Math.abs(dy) * nodeW) {
    return dx > 0 ? 'r' : 'l'
  } else {
    return dy > 0 ? 'b' : 't'
  }
}

function getValidSides(aPos: { x: number; y: number }, bPos: { x: number; y: number }): string[] {
  const nodeW = 450, nodeH = 160
  const aCx = aPos.x + nodeW / 2
  const aCy = aPos.y + nodeH / 2
  const bCx = bPos.x + nodeW / 2
  const bCy = bPos.y + nodeH / 2

  const sides: string[] = []
  if (bCx > aCx) sides.push('r')
  if (bCx < aCx) sides.push('l')
  if (bCy > aCy) sides.push('b')
  if (bCy < aCy) sides.push('t')

  if (sides.length === 0) sides.push('r')
  return sides
}

// Get candidate handles on valid sides (including corners that touch those sides)
function getCandidateHandles(validSides: string[]): typeof HANDLE_POINTS {
  return HANDLE_POINTS.filter(hp => {
    if (validSides.includes(hp.side)) return true
    // Corner handles: 'tl' is valid if 't' or 'l' is valid
    if (hp.side.length === 2) {
      return hp.side.split('').some(s => validSides.includes(s))
    }
    return false
  })
}

function getHandleOnSide(side: string, pct: number): string {
  return `source-${side}-${pct}`
}

function sameSideAs(a: typeof HANDLE_POINTS[0], b: typeof HANDLE_POINTS[0]): boolean {
  if (a.side === b.side) return true
  // Corner shares side with edge: 'tl' shares with 't' and 'l'
  if (a.side.length === 2) return a.side.includes(b.side)
  if (b.side.length === 2) return b.side.includes(a.side)
  return false
}

// Handle points: 3 per side (25%,50%,75%) + 4 corners = 16 points
// penalty: corner points get x1.3 distance penalty
// cwIndex: clockwise order around the card perimeter (0=tl, going CW)
const HANDLE_POINTS: { id: string; rx: number; ry: number; side: string; penalty: number; cwIndex: number }[] = (() => {
  const pts: { id: string; rx: number; ry: number; side: string; penalty: number; cwIndex: number }[] = []
  // CW order: tl(0) → t-25(1) → t-50(2) → t-75(3) → tr(4) → r-25(5) → r-50(6) → r-75(7) → br(8) → b-75(9) → b-50(10) → b-25(11) → bl(12) → l-75(13) → l-50(14) → l-25(15)
  pts.push({ id: 'source-tl', rx: 0, ry: 0, side: 'tl', penalty: 1.3, cwIndex: 0 })
  pts.push({ id: 'source-t-25', rx: 0.25, ry: 0, side: 't', penalty: 1.0, cwIndex: 1 })
  pts.push({ id: 'source-t-50', rx: 0.5, ry: 0, side: 't', penalty: 1.0, cwIndex: 2 })
  pts.push({ id: 'source-t-75', rx: 0.75, ry: 0, side: 't', penalty: 1.0, cwIndex: 3 })
  pts.push({ id: 'source-tr', rx: 1, ry: 0, side: 'tr', penalty: 1.3, cwIndex: 4 })
  pts.push({ id: 'source-r-25', rx: 1, ry: 0.25, side: 'r', penalty: 1.0, cwIndex: 5 })
  pts.push({ id: 'source-r-50', rx: 1, ry: 0.5, side: 'r', penalty: 1.0, cwIndex: 6 })
  pts.push({ id: 'source-r-75', rx: 1, ry: 0.75, side: 'r', penalty: 1.0, cwIndex: 7 })
  pts.push({ id: 'source-br', rx: 1, ry: 1, side: 'br', penalty: 1.3, cwIndex: 8 })
  pts.push({ id: 'source-b-75', rx: 0.75, ry: 1, side: 'b', penalty: 1.0, cwIndex: 9 })
  pts.push({ id: 'source-b-50', rx: 0.5, ry: 1, side: 'b', penalty: 1.0, cwIndex: 10 })
  pts.push({ id: 'source-b-25', rx: 0.25, ry: 1, side: 'b', penalty: 1.0, cwIndex: 11 })
  pts.push({ id: 'source-bl', rx: 0, ry: 1, side: 'bl', penalty: 1.3, cwIndex: 12 })
  pts.push({ id: 'source-l-75', rx: 0, ry: 0.75, side: 'l', penalty: 1.0, cwIndex: 13 })
  pts.push({ id: 'source-l-50', rx: 0, ry: 0.5, side: 'l', penalty: 1.0, cwIndex: 14 })
  pts.push({ id: 'source-l-25', rx: 0, ry: 0.25, side: 'l', penalty: 1.0, cwIndex: 15 })
  return pts
})()

function forceLayout(
  nodes: any[],
  edges: any[],
  iterations = 400
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>()

  const n = nodes.length
  if (n === 0) return new Map()

  // Place CENTER node at origin, others in a circle around it
  const centerNode = nodes.find(nd => nd.data?.isCenter)
  const radius = Math.max(600, n * 100)

  if (centerNode) {
    positions.set(centerNode.id, { x: 0, y: 0, vx: 0, vy: 0 })
    const others = nodes.filter(nd => nd.id !== centerNode.id)
    others.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / others.length
      positions.set(node.id, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      })
    })
  } else {
    nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / n
      positions.set(node.id, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      })
    })
  }

  const REPULSION = 500000
  const ATTRACTION = 0.002
  const DAMPING = 0.85
  const MIN_DISTANCE = 450

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations

    for (let i = 0; i < nodes.length; i++) {
      const a = positions.get(nodes[i].id)!
      for (let j = i + 1; j < nodes.length; j++) {
        const b = positions.get(nodes[j].id)!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 1) { dx = 1; dy = 1; dist = 1.4 }

        const effectiveDist = Math.max(dist, 1)
        let force = REPULSION / (effectiveDist * effectiveDist)
        if (dist < MIN_DISTANCE) {
          force += (MIN_DISTANCE - dist) * 2
        }

        const fx = (dx / effectiveDist) * force * temp
        const fy = (dy / effectiveDist) * force * temp

        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
      }
    }

    for (const edge of edges) {
      const a = positions.get(edge.source)
      const b = positions.get(edge.target)
      if (!a || !b) continue

      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < MIN_DISTANCE) continue

      const force = (dist - MIN_DISTANCE) * ATTRACTION * temp
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force

      a.vx += fx; a.vy += fy
      b.vx -= fx; b.vy -= fy
    }

    // Apply velocity (center node has strong gravity toward origin)
    // Orphan nodes (no mesh group edges) get pulled to top-left
    for (const [id, pos] of positions) {
      if (centerNode && id === centerNode.id) {
        pos.vx -= pos.x * 0.1
        pos.vy -= pos.y * 0.1
      }
      pos.x += pos.vx * DAMPING
      pos.y += pos.vy * DAMPING
      pos.vx *= 0.3
      pos.vy *= 0.3
    }
  }

  // After layout: place orphan nodes in a grid at top-left
  const orphanIds = nodes
    .filter(nd => {
      if (nd.data?.isCenter) return false // CENTER is not an orphan
      const g = nd.data?.groups || []
      return g.length === 0 ||
        (g.length === 1 && g[0] === 'CENTER_GROUP') ||
        (g.length === 2 && g.includes('CENTER_GROUP') && g.includes('ORPHAN_GROUP'))
    })
    .map(nd => nd.id)

  // Find the leftmost/topmost position of non-orphan nodes
  let minX = Infinity, minY = Infinity
  for (const [id, pos] of positions) {
    if (!orphanIds.includes(id)) {
      if (pos.x < minX) minX = pos.x
      if (pos.y < minY) minY = pos.y
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0 }

  // Place orphans in a grid (sqrt(n) columns) to the left of everything else
  const cols = Math.floor(Math.sqrt(orphanIds.length)) || 1
  orphanIds.forEach((id, i) => {
    const pos = positions.get(id)!
    const row = Math.floor(i / cols)
    const col = i % cols
    pos.x = minX - 800 + col * 500
    pos.y = minY + row * 250
  })

  const result = new Map<string, { x: number; y: number }>()
  let cx = 0, cy = 0
  for (const pos of positions.values()) { cx += pos.x; cy += pos.y }
  cx /= n; cy /= n

  for (const [id, pos] of positions) {
    result.set(id, { x: pos.x - cx + 800, y: pos.y - cy + 600 })
  }

  return result
}
