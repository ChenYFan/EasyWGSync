// Draft store: the single source of truth for the editor's working copy.
//
// - `base`     : read-only peer/center info from WGDashboard (never edited)
// - `persisted`: last-saved config snapshot (diff baseline)
// - `draft`    : reactive deep clone of persisted; ALL edits mutate this
// - `graphData`: derived live from (base, draft) — the graph reflects unsaved edits
//
// Nothing hits config.json until commit() PUTs the whole draft.

import type { SyncConfig, PeerExtraConfig, P2PConfig } from '~/types'
import { deriveGraphData, type GraphBase } from '~/composables/useGraphDerive'
import { renderHybridMesh, addDeclaration, removeDeclaration, addRoaming, removeRoaming } from '~/composables/useHybridMesh'
import { authFetch } from '~/composables/useAuth'

const EMPTY_CONFIG: SyncConfig = {
  GLOBAL_LISTEN_PORT: null,
  GLOBAL_DNS: true,
  GLOBAL_SCRIPTS: {},
  MESH_GROUPS: {},
  EXTRA_CONFIG: {},
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export function useDraft() {
  const base = useState<GraphBase>('draft-base', () => ({
    basePeers: [],
    centerPubKey: '',
    onlineEndpoints: {},
  }))
  const persisted = useState<SyncConfig>('draft-persisted', () => clone(EMPTY_CONFIG))
  const draft = useState<SyncConfig>('draft-current', () => clone(EMPTY_CONFIG))
  const loaded = useState<boolean>('draft-loaded', () => false)
  const previewOpen = useState<boolean>('draft-preview-open', () => false)

  // Frontend-only: virtual groups whose edges are hidden (CENTER_GROUP hidden by
  // default to reduce clutter). Members + group boxes still render.
  const hiddenVirtualGroups = useState<Set<string>>('hidden-virtual-groups', () => new Set(['CENTER_GROUP']))

  function toggleVirtualGroupVisible(name: string) {
    const s = new Set(hiddenVirtualGroups.value)
    if (s.has(name)) s.delete(name); else s.add(name)
    hiddenVirtualGroups.value = s
  }

  // Live-derived graph from the draft — render HYBRID_MESH intent first,
  // then derive graph from the rendered config.
  const graphData = computed(() => {
    const rendered = renderHybridMesh(draft.value, base.value)
    return deriveGraphData(base.value, rendered, hiddenVirtualGroups.value)
  })

  const isDirty = computed(() =>
    JSON.stringify(persisted.value) !== JSON.stringify(draft.value)
  )

  // --- Load from backend ---
  async function load() {
    const data = await authFetch('/api/admin/graph') as any
    base.value = {
      basePeers: data.basePeers || [],
      centerPubKey: data.centerPubKey || '',
      onlineEndpoints: data.onlineEndpoints || {},
    }
    persisted.value = clone(data.config)
    draft.value = clone(data.config)
    loaded.value = true
  }

  // --- Edits (mutate draft only) ---
  function upsertPeer(pubkey: string, data: PeerExtraConfig) {
    // Peer form owns all non-P2P fields (replace them); preserve P2P_CONFIG,
    // which is managed separately via the connection editor.
    const existing = draft.value.EXTRA_CONFIG[pubkey] || {}
    const next: PeerExtraConfig = { ...data }
    if (existing.P2P_CONFIG) next.P2P_CONFIG = existing.P2P_CONFIG
    draft.value.EXTRA_CONFIG[pubkey] = next
  }

  // When target is the CENTER node, P2P config is stored under the special
  // 'CENTRAL_NODE' key (matches config-generator). Otherwise use the target pubkey.
  function p2pKey(target: string): string {
    return target === base.value.centerPubKey ? 'CENTRAL_NODE' : target
  }

  function upsertP2P(source: string, target: string, data: P2PConfig) {
    const src = draft.value.EXTRA_CONFIG[source] || {}
    src.P2P_CONFIG = { ...(src.P2P_CONFIG || {}), [p2pKey(target)]: data }
    draft.value.EXTRA_CONFIG[source] = src
  }

  function resetP2P(source: string, target: string) {
    const src = draft.value.EXTRA_CONFIG[source]
    const key = p2pKey(target)
    if (src?.P2P_CONFIG?.[key]) {
      delete src.P2P_CONFIG[key]
    }
  }

  // Helper: get a group's {PEERS,ENABLED} normalized (handles legacy string[])
  function getGroup(name: string): { PEERS: string[]; ENABLED: boolean } {
    const g = draft.value.MESH_GROUPS[name]
    if (!g) return { PEERS: [], ENABLED: true }
    if (Array.isArray(g as any)) return { PEERS: g as unknown as string[], ENABLED: true }
    return { PEERS: (g as any).PEERS || [], ENABLED: (g as any).ENABLED !== false }
  }

  function createGroup(name: string, members: string[] = []) {
    draft.value.MESH_GROUPS[name] = { PEERS: members, ENABLED: true }
  }

  function deleteGroup(name: string) {
    delete draft.value.MESH_GROUPS[name]
  }

  function setGroupMembers(name: string, members: string[]) {
    const cur = getGroup(name)
    draft.value.MESH_GROUPS[name] = { PEERS: members, ENABLED: cur.ENABLED }
  }

  function setGroupEnabled(name: string, enabled: boolean) {
    const cur = getGroup(name)
    draft.value.MESH_GROUPS[name] = { PEERS: cur.PEERS, ENABLED: enabled }
  }

  function addToGroup(name: string, pubkey: string) {
    const cur = getGroup(name)
    if (!cur.PEERS.includes(pubkey)) {
      draft.value.MESH_GROUPS[name] = { PEERS: [...cur.PEERS, pubkey], ENABLED: cur.ENABLED }
    }
  }

  function removeFromGroup(name: string, pubkey: string) {
    const cur = getGroup(name)
    draft.value.MESH_GROUPS[name] = { PEERS: cur.PEERS.filter(m => m !== pubkey), ENABLED: cur.ENABLED }
  }

  // === HYBRID_MESH intent-layer methods (replace old relayFor/setAsGateway) ===
  // These modify the HYBRID_MESH declarations (intent), NOT ALLOWED_IPS directly.
  // The renderer (renderHybridMesh) converts intent → ALLOWED_IPS at display time.

  function addRelay(pub: string, priv: string) {
    draft.value.HYBRID_MESH = addDeclaration(draft.value.HYBRID_MESH, 'RELAY', pub, priv)
  }
  function removeRelay(pub: string, priv: string) {
    draft.value.HYBRID_MESH = removeDeclaration(draft.value.HYBRID_MESH, 'RELAY', pub, priv)
  }
  function addProxy(pub: string, priv: string) {
    draft.value.HYBRID_MESH = addDeclaration(draft.value.HYBRID_MESH, 'PROXY', pub, priv)
  }
  function removeProxy(pub: string, priv: string) {
    draft.value.HYBRID_MESH = removeDeclaration(draft.value.HYBRID_MESH, 'PROXY', pub, priv)
  }
  // Gateway: PUBLIC=high(exit A), PRIVATE=low(B). B→A edge.
  function addGateway(pub: string, priv: string) {
    draft.value.HYBRID_MESH = addDeclaration(draft.value.HYBRID_MESH, 'GATEWAY', pub, priv)
  }
  function removeGateway(pub: string, priv: string) {
    draft.value.HYBRID_MESH = removeDeclaration(draft.value.HYBRID_MESH, 'GATEWAY', pub, priv)
  }
  function addRoamingEntry(pub: string, priv: string, type: 'flatten' | 'nat') {
    draft.value.HYBRID_MESH = addRoaming(draft.value.HYBRID_MESH, pub, priv, type)
  }
  function removeRoamingEntry(pub: string, priv: string) {
    draft.value.HYBRID_MESH = removeRoaming(draft.value.HYBRID_MESH, pub, priv)
  }

  function updateGlobal(patch: Partial<Pick<SyncConfig, 'GLOBAL_LISTEN_PORT' | 'GLOBAL_DNS' | 'GLOBAL_SCRIPTS'>>) {
    Object.assign(draft.value, patch)
  }

  // --- Commit / discard ---
  async function commit() {
    const saved = await authFetch('/api/admin/config-bulk', {
      method: 'PUT',
      body: draft.value,
    }) as SyncConfig
    persisted.value = clone(saved)
    draft.value = clone(saved)
  }

  function discard() {
    draft.value = clone(persisted.value)
  }

  return {
    base,
    persisted,
    draft,
    loaded,
    previewOpen,
    graphData,
    hiddenVirtualGroups,
    toggleVirtualGroupVisible,
    isDirty,
    load,
    upsertPeer,
    upsertP2P,
    resetP2P,
    createGroup,
    deleteGroup,
    setGroupMembers,
    setGroupEnabled,
    addToGroup,
    removeFromGroup,
    addRelay,
    removeRelay,
    addProxy,
    removeProxy,
    addGateway,
    removeGateway,
    addRoamingEntry,
    removeRoamingEntry,
    updateGlobal,
    commit,
    discard,
  }
}
