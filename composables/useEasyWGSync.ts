// EasyWGSyncModel — centralized topology data access + quick health checks.

import { TopologyModel } from '~/composables/useTopology'
import { classifyIP } from '~/composables/useWgConfigParser'
import { useDraft } from '~/composables/useDraft'
import type { GraphBase } from '~/composables/useGraphDerive'

export class EasyWGSyncModel {
  nodes: any[]
  edges: any[]
  meshGroups: Record<string, { members: string[]; comment: string; virtual: boolean }>
  config: any

  constructor(graphData: any, config?: any) {
    this.nodes = graphData?.nodes || []
    this.edges = graphData?.edges || []
    this.meshGroups = graphData?.meshGroups || {}
    this.config = config || graphData?.config || null
  }

  // Reuse the global GraphBase (interfaceInfo/globalDefaults are network-wide).
  private getTopologyModel(): TopologyModel {
    const { base, draft } = useDraft()
    return new TopologyModel(base.value, draft.value)
  }

  // Node lookups

  getNode(id: string) {
    return this.nodes.find(n => n.id === id)
  }

  getNodeName(id: string): string {
    return this.getNode(id)?.data?.fileName || id.slice(0, 12)
  }

  getNodeComment(id: string): string {
    return this.getNode(id)?.data?.comments || ''
  }

  isCenter(id: string): boolean {
    return !!this.getNode(id)?.data?.isCenter
  }

  // === IP lookups (perspective-based) ===

  // Priority: P2P_CONFIG AllowedIPs (per-edge override) > toId's GLOBAL ALLOWED_IPS
  // (declared to all peers) > toId's real address
  getAllowedIPsFrom(fromId: string, toId: string): string[] {
    const edge = this.edges.find(
      (e: any) => e.source === fromId && e.target === toId
    )
    if (edge?.data?.p2pAllowedIPs?.length > 0) {
      return edge.data.p2pAllowedIPs
    }
    // GLOBAL ALLOWED_IPS: toId's OWN converged AllowedIPs (incl. relay'd IPs)
    const globalIPs = this.config?.peers?.[toId]?.ownAllowedIPs
    if (globalIPs && globalIPs.length > 0) {
      return [...globalIPs]
    }
    // Fallback: node's real address
    const node = this.getNode(toId)
    const addr = node?.data?.address || ''
    return addr ? addr.split(',').map((s: string) => s.trim()) : []
  }

  getDisplayIPFrom(fromId: string, toId: string): string {
    const ips = this.getAllowedIPsFrom(fromId, toId)
    if (ips.length === 0) return ''
    // Prefer IPv4, fallback IPv6
    const ipv4 = ips.find(ip => ip.includes('.'))
    if (ipv4) return ips.filter(ip => ip.includes('.')).join(', ')
    return ips[0]
  }

  // Get real address of a node (not perspective-based). Validates each token
  // via classifyIP so an embedded-IPv4 v6 tail isn't misclassified as v4.
  // Returns the CIDR form (with /prefix) as stored in the address field.
  getRealIPv4(id: string): string {
    const addr = this.getNode(id)?.data?.address || ''
    return addr.split(',').map((s: string) => s.trim()).find((s: string) => classifyIP(s) === 'v4') || ''
  }

  getRealIPv6(id: string): string {
    const addr = this.getNode(id)?.data?.address || ''
    return addr.split(',').map((s: string) => s.trim()).find((s: string) => classifyIP(s) === 'v6') || ''
  }

  // === Endpoint lookups ===

  getEndpointFrom(fromId: string, toId: string): string {
    const edge = this.edges.find(
      (e: any) => e.source === fromId && e.target === toId
    )
    return edge?.data?.p2pEndpoint || ''
  }

  // === Group lookups ===

  getGroup(name: string) {
    return this.meshGroups[name]
  }

  isVirtualGroup(name: string): boolean {
    return !!this.meshGroups[name]?.virtual
  }

  getGroupsOf(nodeId: string): string[] {
    return this.getNode(nodeId)?.data?.groups || []
  }

  // Get all directly connected peers of a node (via real MeshGroups)
  // If the node is CENTER, include virtual group members
  getDirectPeers(nodeId: string): string[] {
    const groups = this.getGroupsOf(nodeId)
    const isCenterNode = this.isCenter(nodeId)
    const peers = new Set<string>()

    for (const group of groups) {
      if (this.isVirtualGroup(group) && !isCenterNode) continue
      const members = this.meshGroups[group]?.members || []
      for (const m of members) {
        if (m !== nodeId) peers.add(m)
      }
    }

    // Always add CENTER for non-center nodes
    if (!isCenterNode) {
      const centerNode = this.nodes.find(n => n.data?.isCenter)
      if (centerNode) peers.add(centerNode.id)
    }

    return [...peers]
  }

  // === Edge lookups ===

  getEdge(sourceId: string, targetId: string) {
    return this.edges.find((e: any) => e.source === sourceId && e.target === targetId)
  }

  hasP2PConfig(sourceId: string, targetId: string): boolean {
    return !!this.getEdge(sourceId, targetId)?.data?.hasP2PConfig
  }

  // Get shared groups between two nodes
  getSharedGroups(nodeA: string, nodeB: string): string[] {
    const groupsA = this.getGroupsOf(nodeA)
    const groupsB = this.getGroupsOf(nodeB)
    return groupsA.filter(g => groupsB.includes(g))
  }

  // === Peer info for display ===

  getPeerDisplayInfo(peerId: string, fromPerspective?: string) {
    const node = this.getNode(peerId)
    const ipv4 = fromPerspective
      ? this.getDisplayIPFrom(fromPerspective, peerId)
      : this.getRealIPv4(peerId)

    return {
      id: peerId,
      name: this.getNodeName(peerId),
      pubkey: node?.data?.publicKey || peerId,
      comment: this.getNodeComment(peerId),
      ipv4,
      isCenter: this.isCenter(peerId),
      // CENTER reuses the virtual-group card STYLING only (distinct chip). This
      // is purely cosmetic — do NOT read isVirtual to infer routability/editability.
      isVirtual: this.isCenter(peerId),
      endpoint: fromPerspective ? this.getEndpointFrom(fromPerspective, peerId) : (node?.data?.endpoint || ''),
    }
  }

  getDirectPeersInfo(nodeId: string) {
    const peerIds = this.getDirectPeers(nodeId)
    return peerIds
      .map(id => this.getPeerDisplayInfo(id, nodeId))
      .sort((a, b) => {
        if (a.isCenter && !b.isCenter) return -1
        if (!a.isCenter && b.isCenter) return 1
        return a.name.localeCompare(b.name)
      })
  }

  getGroupMembersInfo(groupName: string) {
    const members = this.meshGroups[groupName]?.members || []
    return members
      .map(id => this.getPeerDisplayInfo(id))
      .sort((a, b) => {
        if (a.isCenter && !b.isCenter) return -1
        if (!a.isCenter && b.isCenter) return 1
        return a.name.localeCompare(b.name)
      })
  }

  // Get sorted groups for a node (virtual first)
  getSortedGroupsOf(nodeId: string) {
    const groups = this.getGroupsOf(nodeId)
    return [...groups].sort((a, b) => {
      const aVirtual = this.isVirtualGroup(a)
      const bVirtual = this.isVirtualGroup(b)
      if (aVirtual && !bVirtual) return -1
      if (!aVirtual && bVirtual) return 1
      return 0
    }).map(name => ({
      name,
      color: '',
      comment: this.meshGroups[name]?.comment || '',
      virtual: this.isVirtualGroup(name),
      full: this.isVirtualGroup(name),
      count: this.meshGroups[name]?.members?.length || 0,
    }))
  }

  // === Config health check ===

  // QUICK (static) health check — runs on every draft change. Validates only the
  // high-level abstraction layer + connection semantics (cheap, no rendering).
  // The duplicate-AllowedIPs / reachability checks live in the DYNAMIC full check
  // (composables/useHealthFull.ts), which renders each node's real config.
  // - gatewayUniqueness: a node with more than one active gateway (error).
  // - relayUniqueness: a node DIRECTLY relayed by more than one node (error).
  // - connectionErrors: declarations whose pair has NO relationship at all (error).
  // - connectionWarnings: declarations whose pair only exists in a DISABLED group (warning).
  quickCheck(): {
    gatewayUniqueness: Array<{ node: string; name: string; exits: Array<{ id: string; name: string }> }>
    relayUniqueness: Array<{ node: string; name: string; relayers: Array<{ id: string; name: string }> }>
    connectionErrors: Array<{ kind: string; a: string; aName: string; b: string; bName: string }>
    connectionWarnings: Array<{ kind: string; a: string; aName: string; b: string; bName: string }>
  } {
    const topo = this.getTopologyModel()

    // --- Gateway uniqueness: each node may have at most one gateway exit. ---
    const gatewayUniqueness: Array<{ node: string; name: string; exits: Array<{ id: string; name: string }> }> = []
    const checked = new Set<string>()
    for (const gw of topo.getGatewayDeclarations()) {
      if (checked.has(gw.PRIVATE_PEER)) continue
      checked.add(gw.PRIVATE_PEER)
      const exits = topo.getGatewayExitsOf(gw.PRIVATE_PEER)
      if (exits.length > 1) {
        gatewayUniqueness.push({
          node: gw.PRIVATE_PEER,
          name: this.getNodeName(gw.PRIVATE_PEER),
          exits: exits.map(id => ({ id, name: this.getNodeName(id) })),
        })
      }
    }

    // --- Relay uniqueness: each node may be DIRECTLY relayed by at most one
    // node. Transitive relay (chain A→B→C) is legitimate, NOT a violation;
    // only count direct relayers (nodes that declare X in a RELAY/flatten-Roaming). ---
    const relayUniqueness: Array<{ node: string; name: string; relayers: Array<{ id: string; name: string }> }> = []
    const hm = this.config?.hybridMesh
    const relayedNodes = new Set<string>()
    const collectRelayed = (list: any[]) => {
      for (const d of (list || [])) {
        if (d.ENABLED !== false) relayedNodes.add(d.PRIVATE_PEER)
      }
    }
    collectRelayed(hm?.DECLARATIONS?.RELAY)
    collectRelayed((hm?.ROAMING || []).filter((r: any) => r.TYPE === 'flatten'))
    for (const node of relayedNodes) {
      const relayers = topo.getDirectRelayersOf(node)
      if (relayers.length > 1) {
        relayUniqueness.push({
          node,
          name: this.getNodeName(node),
          relayers: relayers.map(id => ({ id, name: this.getNodeName(id) })),
        })
      }
    }

    // --- Missing connections: declarations whose pair lacks an ENABLED connection.
    // Split into errors ('none' — no relationship at all, declaration cannot apply)
    // and warnings ('disabled' — relationship exists in a disabled group). ---
    const connectionErrors: Array<{ kind: string; a: string; aName: string; b: string; bName: string }> = []
    const connectionWarnings: Array<{ kind: string; a: string; aName: string; b: string; bName: string }> = []
    const checkDecl = (kind: string, list: any[], pubKey: 'PUBLIC_PEER', privKey: 'PRIVATE_PEER') => {
      for (const d of (list || [])) {
        if (d.ENABLED === false) continue
        const a = d[pubKey], b = d[privKey]
        const cls = topo.classifyConnection(a, b)
        if (cls === 'none') {
          connectionErrors.push({ kind, a, aName: this.getNodeName(a), b, bName: this.getNodeName(b) })
        } else if (cls === 'disabled') {
          connectionWarnings.push({ kind, a, aName: this.getNodeName(a), b, bName: this.getNodeName(b) })
        }
      }
    }
    checkDecl('GATEWAY', hm?.DECLARATIONS?.GATEWAY, 'PUBLIC_PEER', 'PRIVATE_PEER')
    checkDecl('RELAY', hm?.DECLARATIONS?.RELAY, 'PUBLIC_PEER', 'PRIVATE_PEER')
    checkDecl('PROXY', hm?.DECLARATIONS?.PROXY, 'PUBLIC_PEER', 'PRIVATE_PEER')
    checkDecl('ROAMING', hm?.ROAMING, 'PUBLIC_PEER', 'PRIVATE_PEER')

    return {
      gatewayUniqueness,
      relayUniqueness,
      connectionErrors,
      connectionWarnings,
    }
  }
}
