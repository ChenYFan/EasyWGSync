// Pure derivation: read-only base data + an editable config => full graph data
// (nodes / edges / mesh groups incl. virtual CENTER_GROUP & ORPHAN_GROUP).
//
// This is the exact logic that used to live in server/api/admin/graph.get.ts,
// moved client-side so the draft can recompute the graph instantly without
// hitting the backend. Output shape matches what EasyWGSyncModel / panels expect.

import type { SyncConfig } from '~/types'

export interface GraphBase {
  basePeers: { publicKey: string; fileName: string; address: string; isOnline: boolean }[]
  centerPubKey: string
  onlineEndpoints: Record<string, string>
}

export interface DerivedGraph {
  nodes: any[]
  edges: any[]
  meshGroups: Record<string, { members: string[]; comment: string; virtual: boolean; enabled: boolean }>
  globalConfig: {
    GLOBAL_LISTEN_PORT: number | null | undefined
    GLOBAL_DNS: boolean
    GLOBAL_SCRIPTS: Record<string, string>
  }
  // Raw config reference (for Relay/Gateway identification in EasyWGSyncModel)
  config: SyncConfig
}

export function deriveGraphData(base: GraphBase, config: SyncConfig, hiddenGroups?: Set<string>): DerivedGraph {
  const { basePeers, centerPubKey, onlineEndpoints } = base
  const EXTRA = config.EXTRA_CONFIG || {}
  const MESH = config.MESH_GROUPS || {}

  const nodes: any[] = []
  const knownPubKeys = new Set<string>()

  // CENTER node first
  if (centerPubKey) {
    knownPubKeys.add(centerPubKey)
    nodes.push({
      id: centerPubKey,
      type: 'peer',
      data: {
        publicKey: centerPubKey,
        fileName: 'CENTER',
        comments: '',
        endpoint: null,
        isOnline: true,
        isCenter: true,
        address: 'ALL',
        dns: null,
        groups: ['CENTER_GROUP'] as string[],
      },
    })
  }

  // Peers known to WGDashboard
  for (const peer of basePeers) {
    const pubKey = peer.publicKey
    if (!pubKey || knownPubKeys.has(pubKey)) continue
    knownPubKeys.add(pubKey)
    const extra = EXTRA[pubKey]
    nodes.push({
      id: pubKey,
      type: 'peer',
      data: {
        publicKey: pubKey,
        fileName: peer.fileName,
        comments: extra?.COMMENTS || '',
        endpoint: extra?.ENDPOINT || onlineEndpoints[pubKey] || null,
        isOnline: peer.isOnline,
        isCenter: false,
        address: peer.address,
        dns: extra?.DNS || null,
        groups: [] as string[],
      },
    })
  }

  // Peers that only exist in EXTRA_CONFIG (not in WGDashboard)
  for (const pubKey of Object.keys(EXTRA)) {
    if (knownPubKeys.has(pubKey)) continue
    knownPubKeys.add(pubKey)
    const extra = EXTRA[pubKey]
    nodes.push({
      id: pubKey,
      type: 'peer',
      data: {
        publicKey: pubKey,
        fileName: extra.COMMENTS || '',
        comments: extra.COMMENTS || '',
        endpoint: extra.ENDPOINT || null,
        isOnline: pubKey in onlineEndpoints,
        isCenter: false,
        address: '',
        dns: extra.DNS || null,
        groups: [] as string[],
      },
    })
  }

  // Normalize MESH_GROUPS: legacy string[] or new {PEERS, ENABLED} → {members, enabled}
  const MESH_NORMAL: Record<string, { members: string[]; enabled: boolean }> = {}
  for (const [name, g] of Object.entries(MESH)) {
    if (Array.isArray(g)) {
      MESH_NORMAL[name] = { members: g, enabled: true }
    } else {
      const gv = g as any
      MESH_NORMAL[name] = { members: gv.PEERS || [], enabled: gv.ENABLED !== false }
    }
  }

  // Mesh groups + virtual groups
  const meshGroups: DerivedGraph['meshGroups'] = {}
  for (const [name, g] of Object.entries(MESH_NORMAL)) {
    meshGroups[name] = { members: [...g.members], comment: '', virtual: false, enabled: g.enabled }
  }

  const allPeerKeys = nodes.filter(n => !n.data.isCenter).map(n => n.id)
  if (centerPubKey) {
    meshGroups['CENTER_GROUP'] = {
      members: [centerPubKey, ...allPeerKeys],
      comment: '与中心节点互联的节点组',
      virtual: true,
      enabled: true,
    }
  }

  // Real-group memberships on nodes
  const nodesInAnyGroup = new Set<string>()
  for (const [groupName, g] of Object.entries(MESH_NORMAL)) {
    for (const pubKey of g.members) {
      nodesInAnyGroup.add(pubKey)
      const node = nodes.find(n => n.id === pubKey)
      if (node) node.data.groups.push(groupName)
    }
  }

  // ORPHAN_GROUP: peers not in any real mesh group
  const orphanKeys = allPeerKeys.filter(k => !nodesInAnyGroup.has(k))
  if (orphanKeys.length > 0) {
    meshGroups['ORPHAN_GROUP'] = {
      members: orphanKeys,
      comment: '只与中心节点互联的节点组',
      virtual: true,
      enabled: true,
    }
    for (const k of orphanKeys) {
      const node = nodes.find(n => n.id === k)
      if (node) node.data.groups.push('ORPHAN_GROUP')
    }
  }

  if (centerPubKey) {
    for (const node of nodes) {
      if (!node.data.isCenter && !node.data.groups.includes('CENTER_GROUP')) {
        node.data.groups.push('CENTER_GROUP')
      }
    }
  }

  // Edges from real mesh groups (skip disabled groups — keep members but no connections)
  const edgeSet = new Set<string>()
  const edges: any[] = []
  for (const [gname, g] of Object.entries(MESH_NORMAL)) {
    if (!g.enabled) continue
    if (hiddenGroups?.has(gname)) continue // hidden group: keep members, no edges
    const members = g.members
    for (const src of members) {
      for (const tgt of members) {
        if (src === tgt) continue
        const edgeKey = `${src}->${tgt}`
        if (edgeSet.has(edgeKey)) continue
        edgeSet.add(edgeKey)

        const sharedGroups = Object.entries(MESH_NORMAL)
          .filter(([_, gg]) => gg.enabled && gg.members.includes(src) && gg.members.includes(tgt))
          .map(([n]) => n)
        const p2p = EXTRA[src]?.P2P_CONFIG?.[tgt]

        edges.push({
          id: edgeKey,
          source: src,
          target: tgt,
          data: {
            groups: sharedGroups,
            primaryGroup: sharedGroups[0],
            hasP2PConfig: !!p2p,
            p2pEndpoint: p2p?.ENDPOINT || null,
            p2pAllowedIPs: p2p?.ALLOWED_IPS || [],
          },
        })
      }
    }
  }

  // CENTER edges: bidirectional.
  //  - peer→center (isToCenter): editable, config stored in P2P_CONFIG.CENTRAL_NODE
  //  - center→peer (isFromCenter): read-only
  // Both share CENTER_GROUP; skip entirely if CENTER_GROUP is hidden.
  if (centerPubKey && !hiddenGroups?.has('CENTER_GROUP')) {
    for (const peerKey of allPeerKeys) {
      const centralP2p = EXTRA[peerKey]?.P2P_CONFIG?.['CENTRAL_NODE']

      // peer → center (editable direction)
      const toCenterKey = `${peerKey}->${centerPubKey}`
      if (!edgeSet.has(toCenterKey)) {
        edgeSet.add(toCenterKey)
        edges.push({
          id: toCenterKey,
          source: peerKey,
          target: centerPubKey,
          data: {
            groups: ['CENTER_GROUP'],
            primaryGroup: 'CENTER_GROUP',
            hasP2PConfig: !!centralP2p,
            p2pEndpoint: centralP2p?.ENDPOINT || null,
            p2pAllowedIPs: centralP2p?.ALLOWED_IPS || [],
            isToCenter: true,
          },
        })
      }

      // center → peer (read-only direction)
      const fromCenterKey = `${centerPubKey}->${peerKey}`
      if (!edgeSet.has(fromCenterKey)) {
        edgeSet.add(fromCenterKey)
        edges.push({
          id: fromCenterKey,
          source: centerPubKey,
          target: peerKey,
          data: {
            groups: ['CENTER_GROUP'],
            primaryGroup: 'CENTER_GROUP',
            hasP2PConfig: false,
            p2pEndpoint: null,
            p2pAllowedIPs: [],
            isFromCenter: true,
          },
        })
      }
    }
  }

  // === Relay / Proxy identification (from HYBRID_MESH intent) ===
  // Read declarations directly from HYBRID_MESH (accurate — distinguishes
  // Relay vs Proxy, and isn't confused by manual ALLOWED_IPS edits).
  const idToName = new Map<string, string>()
  for (const n of nodes) idToName.set(n.id, n.data?.fileName || n.id.slice(0, 12))
  const nameOf = (id: string) => idToName.get(id) || id.slice(0, 12)

  const hm = (config as any).HYBRID_MESH
  const relays: Record<string, Array<{ id: string; name: string }>> = {}   // PUBLIC -> [PRIVATE]
  const proxies: Record<string, Array<{ id: string; name: string }>> = {}  // PUBLIC -> [PRIVATE]

  const collect = (decls: any[], into: Record<string, Array<{ id: string; name: string }>>) => {
    for (const d of (decls || [])) {
      if (d.ENABLED === false) continue
      const pub = d.PUBLIC_PEER, priv = d.PRIVATE_PEER
      if (!into[pub]) into[pub] = []
      if (!into[pub].some(r => r.id === priv)) into[pub].push({ id: priv, name: nameOf(priv) })
    }
  }
  collect(hm?.DECLARATIONS?.RELAY, relays)
  collect(hm?.DECLARATIONS?.PROXY, proxies)
  // Roaming: flatten implies relay, nat implies proxy
  for (const r of (hm?.ROAMING || [])) {
    if (r.ENABLED === false) continue
    const into = r.TYPE === 'nat' ? proxies : relays
    if (!into[r.PUBLIC_PEER]) into[r.PUBLIC_PEER] = []
    if (!into[r.PUBLIC_PEER].some((x: any) => x.id === r.PRIVATE_PEER)) {
      into[r.PUBLIC_PEER].push({ id: r.PRIVATE_PEER, name: nameOf(r.PRIVATE_PEER) })
    }
  }

  // Attach to nodes
  for (const n of nodes) {
    n.data.relays = relays[n.id] || []
    n.data.proxies = proxies[n.id] || []
  }

  // === Gateway identification ===
  // A is B's gateway if B->A connection ALLOWED_IPS contains whole domain (/24 or /80).
  // Derive center segments from node /32 addresses (compute the /24 /80 they belong to).
  let segV4 = ''
  let segV6 = ''
  const toNetwork = (cidr: string, prefix: number): string | null => {
    const m = cidr.match(/^([\d.]+)\/\d+$/)
    if (!m) return null
    const parts = m[1].split('.').map(Number)
    const ip = (parts[0] << 24 >>> 0) | (parts[1] << 16 >>> 0) | (parts[2] << 8 >>> 0) | parts[3]
    const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0)
    const net = (ip & mask) >>> 0
    return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`
  }
  const toV6Network = (cidr: string, prefix: number): string | null => {
    // Simple: just return the cidr with the given prefix if it's a /80-ish address.
    // For v6 we match the prefix length directly.
    const m = cidr.match(/^[0-9a-fA-F:]+\/\d+$/)
    if (!m) return null
    // Truncate to network - for simplicity just compare prefix lengths, keep original address base
    return cidr.replace(/\/\d+$/, `/${prefix}`)
  }
  for (const n of nodes) {
    const addr = n.data?.address || ''
    for (const ip of addr.split(',').map((s: string) => s.trim())) {
      if (!segV4 && ip.includes('.')) {
        const net = toNetwork(ip, 24)
        if (net) segV4 = net
      }
      if (!segV6 && ip.includes(':')) {
        const net = toV6Network(ip, 80)
        if (net) segV6 = net
      }
    }
    if (segV4 && segV6) break
  }
  for (const edge of edges) {
    const ips = edge.data?.p2pAllowedIPs || []
    edge.data.isGateway = ips.some((ip: string) => ip === segV4 || ip === segV6)
  }

  return {
    nodes,
    edges,
    meshGroups,
    globalConfig: {
      GLOBAL_LISTEN_PORT: config.GLOBAL_LISTEN_PORT,
      GLOBAL_DNS: config.GLOBAL_DNS,
      GLOBAL_SCRIPTS: (config.GLOBAL_SCRIPTS || {}) as Record<string, string>,
    },
    config,
  }
}
