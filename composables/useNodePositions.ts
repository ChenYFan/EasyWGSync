// Frontend-only persistence of user-dragged node positions (localStorage).
// NOT part of the saved config — purely a local view preference.

const STORAGE_KEY = 'easywg-node-positions'

export interface XY { x: number; y: number }

export function useNodePositions() {
  const positions = useState<Record<string, XY>>('node-positions', () => ({}))
  const resetTick = useState<number>('node-positions-reset', () => 0)

  // Load from localStorage (client only).
  function hydrate() {
    if (!import.meta.client) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) positions.value = JSON.parse(raw)
    } catch { /* corrupt/unavailable storage — ignore, start empty */ }
  }

  function persist() {
    if (!import.meta.client) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(positions.value))
    } catch { /* quota/unavailable — ignore */ }
  }

  function get(id: string): XY | undefined {
    return positions.value[id]
  }

  function set(id: string, pos: XY) {
    // round to whole pixels — sub-pixel noise from drag isn't worth storing
    positions.value = { ...positions.value, [id]: { x: Math.round(pos.x), y: Math.round(pos.y) } }
    persist()
  }

  // Overlay cached positions onto freshly laid-out nodes.
  function applyTo<T extends { id: string; type?: string; position: XY }>(nodes: T[]): T[] {
    return nodes.map((n) => {
      const cached = positions.value[n.id]
      return cached ? { ...n, position: { ...cached } } : n
    })
  }

  function clear(id?: string) {
    if (id === undefined) { positions.value = {}; resetTick.value++ }
    else { const next = { ...positions.value }; delete next[id]; positions.value = next }
    persist()
  }

  return { positions, resetTick, hydrate, get, set, applyTo, clear }
}
