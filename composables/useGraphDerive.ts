// Derive the full graph (nodes/edges/meshGroups) from base data + FinalConf.
// Runs client-side so the draft recomputes instantly without hitting the backend.

import type { SyncConfig, DefaultPeerConfig, WGDInterfaceInfo, WGDGlobalDefaults } from '~/types'
import type { FinalConf } from '~/composables/useRenderModel'
import { TopologyModel, normalizeMeshGroups } from '~/composables/useTopology'

export interface GraphBase {
  basePeers: { publicKey: string; fileName: string; isOnline: boolean; default: DefaultPeerConfig }[]
  centerPubKey: string
  onlineEndpoints: Record<string, string>
  interfaceInfo?: WGDInterfaceInfo | null
  globalDefaults?: WGDGlobalDefaults
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
  // The merged final config (for Relay/Gateway identification in EasyWGSyncModel).
  config: FinalConf
}

/** Converged sentinel-aware string: 'none' + '' → undefined. */
function realStr(v: string | undefined): string | undefined {
  return v && v !== 'none' ? v : undefined
}
/** Converged AllowedIPs list, dropping the ['none'] sentinel. */
function realIPs(v: string[] | undefined): string[] {
  if (!v || (v.length === 1 && v[0] === 'none')) return []
  return v
}


export function deriveGraphData(base: GraphBase, finalConf: FinalConf, hiddenGroups?: Set<string>): DerivedGraph {
  const { basePeers, centerPubKey, onlineEndpoints } = base
  const PEERS = finalConf.peers
  const MESH = finalConf.meshGroups || {}

  const nodes: any[] = []
  const knownPubKeys = new Set<string>()

  // CENTER node: real interface address + listen port from interfaceInfo.
  if (centerPubKey) {
    knownPubKeys.add(centerPubKey)
    const ifAddr = base.interfaceInfo?.Address?.trim()
    const ifPort = base.interfaceInfo?.ListenPort
    nodes.push({
      id: centerPubKey,
      type: 'peer',
      data: {
        publicKey: centerPubKey,
        fileName: 'CENTER',
        comments: '',
        endpoint: onlineEndpoints[centerPubKey] || (ifPort ? `:${ifPort}` : null),
        isOnline: true,
        isCenter: true,
        address: ifAddr || 'ALL',
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
    const fp = PEERS[pubKey]
    nodes.push({
      id: pubKey,
      type: 'peer',
      data: {
        publicKey: pubKey,
        fileName: peer.fileName,
        comments: realStr(fp?.comments) || '',
        endpoint: realStr(fp?.endpoint) || onlineEndpoints[pubKey] || null,
        isOnline: peer.isOnline,
        isCenter: false,
        address: (fp?.address || peer.default.address).join(', ') || '',
        dns: realStr(fp?.dns) || peer.default.dns?.[0] || null,
        groups: [] as string[],
      },
    })
  }

  // Normalize MESH_GROUPS (shared helper) → {members, enabled}
  const MESH_NORMAL = normalizeMeshGroups(MESH)

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
        const p2p = PEERS[src]?.conns?.[tgt]

        edges.push({
          id: edgeKey,
          source: src,
          target: tgt,
          data: {
            groups: sharedGroups,
            primaryGroup: sharedGroups[0],
            hasP2PConfig: !!p2p,
            p2pEndpoint: realStr(p2p?.endpoint) || null,
            p2pAllowedIPs: realIPs(p2p?.allowedIPs),
          },
        })
      }
    }
  }

  // CENTER edges: bidirectional.
  // peer→center (isToCenter): editable, stored in P2P_CONFIG.CENTRAL_NODE
  // center→peer (isFromCenter): read-only
  if (centerPubKey && !hiddenGroups?.has('CENTER_GROUP')) {
    for (const peerKey of allPeerKeys) {
      const centralP2p = PEERS[peerKey]?.conns?.['CENTRAL_NODE']

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
            p2pEndpoint: realStr(centralP2p?.endpoint) || null,
            p2pAllowedIPs: realIPs(centralP2p?.allowedIPs),
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

  // Relay / Proxy identification from HYBRID_MESH intent.
  const idToName = new Map<string, string>()
  for (const n of nodes) idToName.set(n.id, n.data?.fileName || n.id.slice(0, 12))
  const nameOf = (id: string) => idToName.get(id) || id.slice(0, 12)

  const hm = finalConf.hybridMesh
  const relays: Record<string, Array<{ id: string; name: string }>> = {}   // PUBLIC -> [PRIVATE]
  const proxies: Record<string, Array<{ id: string; name: string }>> = {}  // PUBLIC -> [PRIVATE]

  const collect = (decls: any[] | undefined, into: Record<string, Array<{ id: string; name: string }>>) => {
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

  for (const n of nodes) {
    n.data.relays = relays[n.id] || []
    n.data.proxies = proxies[n.id] || []
  }

  // Gateway identification: edge is gateway iff p2pAllowedIPs contains whole domain network.
  const topoConfig = {
    MESH_GROUPS: finalConf.meshGroups,
    HYBRID_MESH: finalConf.hybridMesh,
    GLOBAL_DNS: finalConf.globalDns,
    GLOBAL_SCRIPTS: finalConf.globalScripts,
    GLOBAL_LISTEN_PORT: finalConf.globalListenPort,
    EXTRA_CONFIG: {},
  } as SyncConfig
  const topo = new TopologyModel(base, topoConfig)
  const { v4: segV4, v6: segV6 } = topo.getDomainNetworks()
  for (const edge of edges) {
    const ips = edge.data?.p2pAllowedIPs || []
    edge.data.isGateway = ips.some((ip: string) => ip === segV4 || ip === segV6)
  }

  // Stamp CENTER's own IP(s) for graph-side consumers.
  if (centerPubKey) {
    const centerNode = nodes.find((n: any) => n.data?.isCenter)
    if (centerNode) centerNode.data.ownIPs = topo.getCenterOwnIPs()
  }

  return {
    nodes,
    edges,
    meshGroups,
    globalConfig: {
      GLOBAL_LISTEN_PORT: finalConf.globalListenPort,
      GLOBAL_DNS: finalConf.globalDns,
      GLOBAL_SCRIPTS: (finalConf.globalScripts || {}) as Record<string, string>,
    },
    config: finalConf,
  }
}
