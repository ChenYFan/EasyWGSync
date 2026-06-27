// EasyWGSync data model class
// Centralizes all topology data access and perspective-based lookups

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

  // === Node lookups ===

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

  // What IP does `fromId` see `toId` as?
  // Priority: P2P_CONFIG AllowedIPs (per-edge override) > toId's GLOBAL ALLOWED_IPS
  // (declared to all peers) > toId's real address
  getAllowedIPsFrom(fromId: string, toId: string): string[] {
    const edge = this.edges.find(
      (e: any) => e.source === fromId && e.target === toId
    )
    if (edge?.data?.p2pAllowedIPs?.length > 0) {
      return edge.data.p2pAllowedIPs
    }
    // GLOBAL ALLOWED_IPS: declared by toId to all its peers
    const globalIPs = this.config?.EXTRA_CONFIG?.[toId]?.ALLOWED_IPS
    if (globalIPs && globalIPs.length > 0) {
      return [...globalIPs]
    }
    // Fallback: node's real address
    const node = this.getNode(toId)
    const addr = node?.data?.address || ''
    return addr ? addr.split(',').map((s: string) => s.trim()) : []
  }

  // Get the display IP string from perspective of `fromId` looking at `toId`
  getDisplayIPFrom(fromId: string, toId: string): string {
    const ips = this.getAllowedIPsFrom(fromId, toId)
    if (ips.length === 0) return ''
    // Prefer IPv4, fallback IPv6
    const ipv4 = ips.find(ip => ip.includes('.'))
    if (ipv4) return ips.filter(ip => ip.includes('.')).join(', ')
    return ips[0]
  }

  // Get real address of a node (not perspective-based)
  getRealIPv4(id: string): string {
    const addr = this.getNode(id)?.data?.address || ''
    return addr.split(',').map((s: string) => s.trim()).find((s: string) => s.includes('.')) || ''
  }

  getRealIPv6(id: string): string {
    const addr = this.getNode(id)?.data?.address || ''
    return addr.split(',').map((s: string) => s.trim()).find((s: string) => s.includes(':')) || ''
  }

  // === Endpoint lookups ===

  // What endpoint does `fromId` use to reach `toId`?
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

  // Build display info for a peer from a given perspective node
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
      isVirtual: this.isCenter(peerId),
      endpoint: fromPerspective ? this.getEndpointFrom(fromPerspective, peerId) : (node?.data?.endpoint || ''),
    }
  }

  // Build display info for all direct peers of a node
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

  // Build display info for group members
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

  // === Relay / Gateway identification ===

  // Get the center network segment (v4 /24, v6 /80) derived from node /32 addresses.
  getCenterSegments(): { v4: string | null; v6: string | null } {
    let v4: string | null = null
    let v6: string | null = null
    const toV4Net = (cidr: string): string | null => {
      const m = cidr.match(/^([\d.]+)\/\d+$/)
      if (!m) return null
      const parts = m[1].split('.').map(Number)
      const ip = (parts[0] << 24 >>> 0) | (parts[1] << 16 >>> 0) | (parts[2] << 8 >>> 0) | parts[3]
      const mask = (~0 << 8) >>> 0 // /24
      const net = (ip & mask) >>> 0
      return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/24`
    }
    for (const n of this.nodes) {
      const addr = n.data?.address || ''
      for (const ip of addr.split(',').map((s: string) => s.trim())) {
        if (!v4 && ip.includes('.')) v4 = toV4Net(ip)
        if (!v6 && ip.includes(':')) v6 = ip.replace(/\/\d+$/, '/80')
      }
      if (v4 && v6) break
    }
    return { v4, v6 }
  }

  // === Config health check ===

  // Detect IP declaration conflicts: multiple nodes' GLOBAL ALLOWED_IPS
  // declare the same IP in a way that's genuinely ambiguous for routing.
  //
  // A relay chain (A relay B relay C) legitimately makes C's IP appear in both
  // A's and B's GLOBAL ALLOWED_IPS (transitive closure) — this is NOT a conflict.
  // A conflict only exists when two claimers are NOT on the same relay chain
  // (neither is a relay-ancestor of the other), so routing to that IP is truly
  // ambiguous and WireGuard would pick by [Peer] order.
  getIpConflicts(): Array<{ ip: string; claimers: Array<{ id: string; name: string }> }> {
    if (!this.config?.EXTRA_CONFIG) return []

    // Build IP -> owner (from node addresses)
    const ipOwner = new Map<string, string>()
    for (const n of this.nodes) {
      const addr = n.data?.address || ''
      for (const ip of addr.split(',').map((s: string) => s.trim())) {
        if (ip.includes('.')) ipOwner.set(ip.replace(/\/\d+$/, ''), n.id)
      }
    }

    // Build relay reachability from HYBRID_MESH: relayReaches[X] = set of nodes X
    // can reach via relay (transitive). A relay B → A reaches B.
    const relayReaches = this.computeRelayReachability()

    // Two claimers are "on the same chain" if one relay-reaches the other.
    const sameChain = (a: string, b: string): boolean => {
      if (a === b) return true
      return (relayReaches.get(a)?.has(b) ?? false) || (relayReaches.get(b)?.has(a) ?? false)
    }

    // Build IP -> list of nodes that GLOBAL-declare it
    const ipClaimers = new Map<string, Array<{ id: string; name: string }>>()
    for (const [aPubkey, extra] of Object.entries(this.config.EXTRA_CONFIG)) {
      const globalIPs = (extra as any)?.ALLOWED_IPS || []
      for (const cidr of globalIPs) {
        const bareIp = cidr.replace(/\/\d+$/, '')
        if (!bareIp.includes('.')) continue
        const owner = ipOwner.get(bareIp)
        if (!owner || owner === aPubkey) continue // own IP or unknown, skip
        if (!ipClaimers.has(bareIp)) ipClaimers.set(bareIp, [])
        const claimers = ipClaimers.get(bareIp)!
        if (!claimers.some(c => c.id === aPubkey)) {
          claimers.push({ id: aPubkey, name: this.getNodeName(aPubkey) })
        }
      }
    }

    const conflicts: Array<{ ip: string; claimers: Array<{ id: string; name: string }> }> = []
    for (const [ip, claimers] of ipClaimers) {
      if (claimers.length <= 1) continue

      // Legitimate if all claimers are pairwise on the same relay chain
      // (totally ordered by relay-reachability). A real conflict needs at least
      // one pair of claimers that are NOT on the same chain.
      let hasConflict = false
      for (let i = 0; i < claimers.length && !hasConflict; i++) {
        for (let j = i + 1; j < claimers.length; j++) {
          if (!sameChain(claimers[i].id, claimers[j].id)) {
            hasConflict = true
            break
          }
        }
      }
      if (!hasConflict) continue // relay chain — legitimate, not a conflict

      const ownerName = this.getNodeName(ipOwner.get(ip) || '')
      conflicts.push({ ip, claimers: [{ id: ipOwner.get(ip) || '', name: ownerName }, ...claimers] })
    }
    return conflicts
  }

  // Build transitive relay reachability from HYBRID_MESH.DECLARATIONS.RELAY +
  // flatten ROAMING (which implies relay). relayReaches[X] = nodes X reaches.
  private computeRelayReachability(): Map<string, Set<string>> {
    const adj = new Map<string, string[]>()
    const hm = this.config?.HYBRID_MESH
    const addEdge = (pub: string, priv: string) => {
      if (!adj.has(pub)) adj.set(pub, [])
      adj.get(pub)!.push(priv)
    }
    for (const d of (hm?.DECLARATIONS?.RELAY || [])) {
      if (d.ENABLED !== false) addEdge(d.PUBLIC_PEER, d.PRIVATE_PEER)
    }
    for (const r of (hm?.ROAMING || [])) {
      if (r.ENABLED !== false && r.TYPE === 'flatten') addEdge(r.PUBLIC_PEER, r.PRIVATE_PEER)
    }

    const reaches = new Map<string, Set<string>>()
    const dfs = (node: string, acc: Set<string>, seen: Set<string>) => {
      for (const next of (adj.get(node) || [])) {
        if (seen.has(next)) continue
        seen.add(next)
        acc.add(next)
        dfs(next, acc, seen)
      }
    }
    for (const start of adj.keys()) {
      const acc = new Set<string>()
      dfs(start, acc, new Set([start]))
      reaches.set(start, acc)
    }
    return reaches
  }

  // Full health check: all issues combined
  healthCheck(): { conflicts: Array<{ ip: string; claimers: Array<{ id: string; name: string }> }> } {
    return {
      conflicts: this.getIpConflicts(),
    }
  }

  // Relay identification: node A is a Relay of B if A's GLOBAL ALLOWED_IPS
  // declares an IP that belongs to B (and not to A itself).
  // Returns map: relayNodeId -> [relayedNodeIds]
  getRelays(): Record<string, string[]> {
    if (!this.config?.EXTRA_CONFIG) return {}
    const result: Record<string, string[]> = {}

    // Build IP -> owner map (from node addresses, strip CIDR)
    const ipOwner = new Map<string, string>()
    for (const n of this.nodes) {
      const owner = n.id
      const addr = n.data?.address || ''
      for (const ip of addr.split(',').map((s: string) => s.trim())) {
        if (ip.includes('.')) {
          ipOwner.set(ip.replace(/\/\d+$/, ''), owner)
        }
      }
    }

    for (const [aPubkey, extra] of Object.entries(this.config.EXTRA_CONFIG)) {
      const globalIPs = (extra as any)?.ALLOWED_IPS || []
      for (const cidr of globalIPs) {
        const bareIp = cidr.replace(/\/\d+$/, '')
        if (!bareIp.includes('.')) continue
        const owner = ipOwner.get(bareIp)
        // Owner exists, and it's not A itself => A relays owner
        if (owner && owner !== aPubkey) {
          if (!result[aPubkey]) result[aPubkey] = []
          if (!result[aPubkey].includes(owner)) result[aPubkey].push(owner)
        }
      }
    }
    return result
  }

  // Gateway identification: A is B's Gateway if B->A connection's ALLOWED_IPS
  // contains the whole domain (v4 /24 or v6 /80).
  // Returns list of { from: B, gateway: A }
  getGateways(): Array<{ from: string; gateway: string }> {
    const { v4, v6 } = this.getCenterSegments()
    const result: Array<{ from: string; gateway: string }> = []

    for (const edge of this.edges) {
      const ips = edge.data?.p2pAllowedIPs || []
      // B->A: edge.source=B, edge.target=A. B treats A as gateway.
      const isWholeDomain = ips.some((ip: string) => ip === v4 || ip === v6)
      if (isWholeDomain) {
        result.push({ from: edge.source, gateway: edge.target })
      }
    }
    return result
  }

  // === Mock TraceRoute ===

  // Find the node that owns a given IP (matches against node addresses)
  findNodeByIp(ip: string): string | null {
    const bare = ip.replace(/\/\d+$/, '')
    for (const n of this.nodes) {
      const addr = n.data?.address || ''
      const ips = addr.split(',').map((s: string) => s.trim())
      for (const nodeIp of ips) {
        if (nodeIp.includes('.') && this.ipv4Matches(bare, nodeIp)) {
          return n.id
        }
      }
    }
    return null
  }

  // Parse CIDR to { ip: number (for v4) or bigint (for v6), prefix: number }
  private parseIPv4(cidr: string): { ip: number; prefix: number } | null {
    const match = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/)
    if (!match) {
      // Try bare IP
      const bareMatch = cidr.match(/^(\d+\.\d+\.\d+\.\d+)$/)
      if (!bareMatch) return null
      const parts = bareMatch[1].split('.').map(Number)
      return { ip: (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3], prefix: 32 }
    }
    const parts = match[1].split('.').map(Number)
    return { ip: (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3], prefix: parseInt(match[2]) }
  }

  private ipv4Matches(targetIp: string, cidr: string): boolean {
    const target = this.parseIPv4(targetIp + '/32')
    const network = this.parseIPv4(cidr)
    if (!target || !network) return false
    const mask = network.prefix === 0 ? 0 : (~0 << (32 - network.prefix)) >>> 0
    return ((target.ip >>> 0) & mask) === ((network.ip >>> 0) & mask)
  }

  private getCIDRPrefix(cidr: string): number {
    const match = cidr.match(/\/(\d+)$/)
    return match ? parseInt(match[1]) : 32
  }

  // Determine if a target IP is covered by any of the allowed IPs
  private findBestRoute(
    fromNodeId: string,
    targetIp: string
  ): { nextHop: string; matchedCIDR: string; prefix: number } | null {
    const peers = this.getDirectPeers(fromNodeId)
    let bestMatch: { nextHop: string; matchedCIDR: string; prefix: number } | null = null

    for (const peerId of peers) {
      const allowedIPs = this.getAllowedIPsFrom(fromNodeId, peerId)
      for (const cidr of allowedIPs) {
        // Skip non-IPv4 for now (simple implementation)
        if (!cidr.includes('.')) continue
        if (this.ipv4Matches(targetIp, cidr)) {
          const prefix = this.getCIDRPrefix(cidr)
          if (!bestMatch || prefix > bestMatch.prefix) {
            bestMatch = { nextHop: peerId, matchedCIDR: cidr, prefix }
          }
        }
      }
    }

    return bestMatch
  }

  // Forward-only trace (no return path check). Used internally by mockTraceRoute.
  private traceForward(
    sourceId: string,
    targetIp: string,
    maxHops = 16
  ): { hops: TraceHop[]; error?: string } {
    const hops: TraceHop[] = []
    const visited = new Set<string>()
    let currentId = sourceId

    hops.push({
      nodeId: currentId,
      nodeName: this.getNodeName(currentId),
      matchedCIDR: null,
      isSource: true,
      isDestination: false,
    })

    for (let i = 0; i < maxHops; i++) {
      const currentNode = this.getNode(currentId)
      const currentAddr = currentNode?.data?.address || ''
      const currentIPs = currentAddr.split(',').map((s: string) => s.trim())

      for (const ip of currentIPs) {
        if (ip.includes('.') && this.ipv4Matches(targetIp, ip)) {
          hops[hops.length - 1].isDestination = true
          return { hops }
        }
      }

      if (visited.has(currentId)) {
        return { hops, error: `路由环路：${this.getNodeName(currentId)} 被重复访问` }
      }
      visited.add(currentId)

      if (this.isCenter(currentId)) {
        const targetNode = this.nodes.find(n => {
          const addr = n.data?.address || ''
          return addr.split(',').map((s: string) => s.trim()).some((ip: string) =>
            ip.includes('.') && this.ipv4Matches(targetIp, ip)
          )
        })
        if (targetNode) {
          hops.push({
            nodeId: targetNode.id,
            nodeName: this.getNodeName(targetNode.id),
            matchedCIDR: 'CENTER direct',
            isSource: false,
            isDestination: true,
          })
          return { hops }
        }
        return { hops, error: `中心节点无法找到目标 ${targetIp} 的所有者` }
      }

      const route = this.findBestRoute(currentId, targetIp)
      if (!route) {
        return { hops, error: `路由不可达：${this.getNodeName(currentId)} 没有覆盖 ${targetIp} 的路由` }
      }

      currentId = route.nextHop
      hops.push({
        nodeId: currentId,
        nodeName: this.getNodeName(currentId),
        matchedCIDR: route.matchedCIDR,
        isSource: false,
        isDestination: false,
      })
    }

    return { hops, error: `超过最大跳数 (${maxHops})` }
  }

  // Single-direction trace (public). Resolves one path from source to target IP.
  // Used by the panel to run forward + return traces independently.
  trace(
    sourceId: string,
    targetIp: string,
    maxHops = 16
  ): { hops: TraceHop[]; error?: string } {
    return this.traceForward(sourceId, targetIp, maxHops)
  }

  // Run mock traceroute: forward trace to target, then return trace back to source IP.
  // Each direction is a complete independent trace; results are joined for display.
  // Also reports whether the two paths are symmetric (return == forward reversed).
  mockTraceRoute(
    sourceId: string,
    targetIp: string,
    maxHops = 16
  ): {
    forward: { hops: TraceHop[]; error?: string }
    return?: { hops: TraceHop[]; error?: string }
    returnError?: string
    symmetric: boolean
  } {
    // Forward trace
    const fwd = this.traceForward(sourceId, targetIp, maxHops)
    if (fwd.error) {
      return { forward: fwd, symmetric: false }
    }

    // Resolve source node's IPv4 for the return trace target (strip CIDR mask)
    const srcNode = this.getNode(sourceId)
    const srcAddr = srcNode?.data?.address || ''
    const srcIpv4Cidr = srcAddr.split(',').map((s: string) => s.trim()).find((s: string) => s.includes('.'))
    const srcIpv4 = srcIpv4Cidr ? srcIpv4Cidr.replace(/\/\d+$/, '') : ''

    if (!srcIpv4) {
      return { forward: fwd, returnError: '无法验证回程：源节点无 IPv4 地址', symmetric: false }
    }

    // Return trace from destination back to source IP
    const destNode = fwd.hops[fwd.hops.length - 1]
    const ret = this.traceForward(destNode.nodeId, srcIpv4, maxHops)

    if (ret.error) {
      return { forward: fwd, returnError: `回程路由不通：${ret.error}`, symmetric: false }
    }

    const lastReturnHop = ret.hops[ret.hops.length - 1]
    if (!lastReturnHop.isDestination) {
      return { forward: fwd, returnError: '回程路由未到达源节点', symmetric: false }
    }

    // Symmetry check: return path should equal forward path reversed
    const fwdIds = fwd.hops.map(h => h.nodeId)
    const retIds = ret.hops.map(h => h.nodeId)
    const symmetric = JSON.stringify(fwdIds.reverse()) === JSON.stringify(retIds)

    return { forward: fwd, return: ret, symmetric }
  }
}

export interface TraceHop {
  nodeId: string
  nodeName: string
  matchedCIDR: string | null
  isSource: boolean
  isDestination: boolean
}
