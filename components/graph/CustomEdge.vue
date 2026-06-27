<template>
  <path :d="path" :style="style" :marker-end="markerEnd" class="vue-flow__edge-path" />
  <path :d="path" fill="none" stroke="transparent" stroke-width="20" class="vue-flow__edge-interaction" />
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: string
  targetPosition: string
  style?: Record<string, any>
  markerEnd?: string
}>()

// Compute bezier path with control points based on handle position
// For corner handles (detected by position + location), use diagonal control points
const path = computed(() => {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition: sp, targetPosition: tp } = props

  const dx = Math.abs(tx - sx)
  const dy = Math.abs(ty - sy)
  const dist = Math.sqrt(dx * dx + dy * dy)
  const offset = Math.min(100, Math.max(30, dist * 0.15))

  // Source control point direction
  const sc = getControlOffset(sp, sx, sy, tx, ty, offset)
  // Target control point direction
  const tc = getControlOffset(tp, tx, ty, sx, sy, offset)

  return `M ${sx} ${sy} C ${sc.x} ${sc.y}, ${tc.x} ${tc.y}, ${tx} ${ty}`
})

function getControlOffset(
  position: string,
  fromX: number, fromY: number,
  toX: number, toY: number,
  offset: number
): { x: number; y: number } {
  // Standard directions
  switch (position) {
    case 'top': return { x: fromX, y: fromY - offset }
    case 'bottom': return { x: fromX, y: fromY + offset }
    case 'left': return { x: fromX - offset, y: fromY }
    case 'right': return { x: fromX + offset, y: fromY }
    default: {
      // Fallback: point toward target (diagonal)
      const dx = toX - fromX
      const dy = toY - fromY
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      return { x: fromX + (dx / len) * offset, y: fromY + (dy / len) * offset }
    }
  }
}
</script>
