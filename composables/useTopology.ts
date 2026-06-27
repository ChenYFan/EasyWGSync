// composables/useTopology.ts
//
// TopologyModel — the single source of truth for topology semantics.
// Pure OO class (no Vue), shared by renderModel (rendering) and
// EasyWGSyncModel (health). Consolidates the relay-closure / domain-network
// logic that was previously duplicated in useHybridMesh + useEasyWGSync.
//
// CENTER model (see mem `center-shortcircuit-asymmetry`):
//   - CENTER is an ordinary peer by default (X→CENTER = CENTER's own host IP).
//   - An implicit virtual Gateway stacks the domain network onto X→CENTER
//     unless X explicitly roams via another exit (useRenderModel mechanism A).
//   - CENTER is an implicit NAT proxy in the simulation: traffic out of CENTER
//     has its source rewritten to CENTER's own IP (useWgConfigParser tracePath).
//   - CENTER is NOT a relay (no RELAY declarations name it); the relay closure
//     only spans explicit RELAY + flatten-Roaming among peers.
//   - Domain network segment (v4 + v6) is a single global value from CENTER's
//     interfaceInfo.Address (fetched once at backend startup), masked to its
//     network address. NOT per-peer, NOT hardcoded.

import type { SyncConfig, Declaration } from '~/types'
import type { GraphBase } from '~/composables/useGraphDerive'
import { parseIPv6ToBigInt, bigIntToV6 } from '~/composables/useWgConfigParser'

export interface NormalizedGroup { members: string[]; enabled: boolean }

/**
 * Normalize MESH_GROUPS — handles both the legacy `string[]` shape and the
 * `{ PEERS, ENABLED }` shape — into `{ members, enabled }`. Single source of
 * truth (was duplicated in deriveGraphData + TopologyModel).
 */
export function normalizeMeshGroups(mesh: Record<string, any> | undefined): Record<string, NormalizedGroup> {
  const out: Record<string, NormalizedGroup> = {}
  for (const [name, g] of Object.entries(mesh || {})) {
    if (Array.isArray(g)) out[name] = { members: g, enabled: true }
    else out[name] = { members: (g as any)?.PEERS || [], enabled: (g as any)?.ENABLED !== false }
  }
  return out
}

/**
 * Mask a v4 CIDR to its network address (clear host bits), keeping the prefix
 * length from the CIDR. "192.168.222.1/24" → "192.168.222.0/24". Used on
 * CENTER's interfaceInfo.Address to derive the domain network segment. Returns
 * null if unparseable.
 */
function maskV4(cidr: string): string | null {
  const m = cidr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d+)$/)
  if (!m) return null
  const parts = m[1].split('.').map(Number)
  if (parts.some(o => o > 255)) return null
  const prefix = Number(m[2])
  if (prefix > 32) return null
  const ip = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  const net = (ip & mask) >>> 0
  return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`
}

/**
 * Mask a v6 CIDR to its network address (clear host bits), keeping the prefix
 * length from the CIDR. Uses BigInt for 128-bit math. "fd00:d00:721::1/80" →
 * "fd00:d00:721::/80". Used on CENTER's interfaceInfo.Address to derive the v6
 * domain network segment. Returns null if unparseable. v6 parse/compress
 * delegated to useWgConfigParser (single source).
 * useWgConfigParser (single source).
 */
function maskV6(cidr: string): string | null {
  const slash = cidr.lastIndexOf('/')
  if (slash < 0) return null
  const addr = cidr.slice(0, slash)
  const prefix = Number(cidr.slice(slash + 1))
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null
  const expanded = parseIPv6ToBigInt(addr)
  if (expanded === null) return null
  // 128-bit mask: top `prefix` bits set.
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix)
  const net = expanded & mask
  return `${bigIntToV6(net)}/${prefix}`
}

export class TopologyModel {
  constructor(
    private base: GraphBase,
    private config: SyncConfig,
  ) {}

  /**
   * Domain networks (v4 + v6) — the WHOLE network segment, a single global value
   * fixed at backend startup (CENTER's interface Address from wgdashboard, e.g.
   * "192.168.222.1/24" → "192.168.222.0/24"). NOT derived per-peer: a peer's own
   * [Interface] Address is its /32 host address, which is NOT the network
   * segment. Falls back to the first basePeer address only if interfaceInfo is
   * unavailable. Single source of truth for gateway stacking + detection.
   */
  getDomainNetworks(): { v4: string | null; v6: string | null } {
    let v4: string | null = null
    let v6: string | null = null
    // Primary source: CENTER's interface Address (the network segment, e.g. /24).
    const ifAddr = this.base.interfaceInfo?.Address
    if (ifAddr) {
      for (const cidr of ifAddr.split(',').map(s => s.trim()).filter(Boolean)) {
        if (!v4 && cidr.includes('.')) v4 = maskV4(cidr)
        if (!v6 && cidr.includes(':')) v6 = maskV6(cidr)
      }
    }
    // Fallback: first basePeer address (only if interfaceInfo unavailable).
    if (!v4 || !v6) {
      for (const p of this.base.basePeers) {
        for (const cidr of (p.default?.address || [])) {
          if (!v4 && cidr.includes('.')) v4 = maskV4(cidr)
          if (!v6 && cidr.includes(':')) v6 = maskV6(cidr)
        }
        if (v4 && v6) break
      }
    }
    return { v4, v6 }
  }

  /**
   * CENTER's own /32 + /128 — its real interface IP (the demotion value, and
   * what CENTER "owns" so a trace targeting it terminates). Authoritative source
   * is WGDashboard's interface Address; falls back to the domain network base
   * (correct when CENTER sits on the network's lowest address).
   */
  getCenterOwnIPs(): string[] {
    const addr = this.base.interfaceInfo?.Address
    if (addr) {
      const ips: string[] = []
      for (const cidr of addr.split(',').map(s => s.trim()).filter(Boolean)) {
        const bare = cidr.replace(/\/\d+$/, '')
        if (bare.includes('.')) ips.push(`${bare}/32`)
        else if (bare.includes(':')) ips.push(`${bare}/128`)
      }
      if (ips.length) return ips
    }
    const { v4, v6 } = this.getDomainNetworks()
    const ips: string[] = []
    if (v4) ips.push(v4.replace(/\/\d+$/, '/32'))
    if (v6) ips.push(v6.replace(/\/\d+$/, '/128'))
    return ips
  }

  /**
   * The endpoint peers dial to reach CENTER — a single global value from the
   * backend-fixed sources: `globalDefaults.remote_endpoint` (CENTER's public
   * host, from wgdashboard) + `interfaceInfo.ListenPort` (CENTER's listen port).
   * Returns null if either is missing. NOT read from a peer's .conf [Peer]
   * Endpoint (that's whichever [Peer] came last — fragile).
   */
  getCenterDialEndpoint(): string | null {
    const host = this.base.globalDefaults?.remote_endpoint
    const port = this.base.interfaceInfo?.ListenPort
    if (!host || !port) return null
    // remote_endpoint may already carry a port (host:port); if so, use as-is.
    if (host.includes(':') && /\]$|:\d+$/.test(host)) return host
    return `${host}:${port}`
  }

  /** Enabled mesh edges (respecting group ENABLED). Set of "src->tgt". */
  getEnabledMeshEdges(): Set<string> {
    const edges = new Set<string>()
    for (const g of Object.values(normalizeMeshGroups(this.config.MESH_GROUPS))) {
      if (!g.enabled) continue
      for (const src of g.members) {
        for (const tgt of g.members) {
          if (src !== tgt) edges.add(`${src}->${tgt}`)
        }
      }
    }
    return edges
  }

  /**
   * Relay transitive closure: EXPLICIT RELAY declarations + Roaming-flatten
   * expansion only. CENTER is NOT included (CENTER does not relay).
   * Respects group ENABLED (a relay edge is only valid if the pair has an
   * underlying connection — same enabled mesh group or manual P2P).
   * Returns Map<pubkey, Set<reachable>>.
   */
  getRelayReachability(): Map<string, Set<string>> {
    const adj = new Map<string, string[]>()
    const addEdge = (pub: string, priv: string) => {
      if (!this.hasUnderlyingConnection(pub, priv)) return
      if (!adj.has(pub)) adj.set(pub, [])
      adj.get(pub)!.push(priv)
      if (!adj.has(priv)) adj.set(priv, [])
    }

    const hm = (this.config as any).HYBRID_MESH
    for (const d of (hm?.DECLARATIONS?.RELAY || []) as Declaration[]) {
      if (d.ENABLED !== false) addEdge(d.PUBLIC_PEER, d.PRIVATE_PEER)
    }
    // Roaming flatten implies relay.
    for (const r of (hm?.ROAMING || []) as any[]) {
      if (r.ENABLED !== false && r.TYPE === 'flatten') addEdge(r.PUBLIC_PEER, r.PRIVATE_PEER)
    }

    const closure = new Map<string, Set<string>>()
    const dfs = (node: string, visited: Set<string>, result: Set<string>) => {
      for (const next of (adj.get(node) || [])) {
        if (visited.has(next)) continue
        visited.add(next)
        result.add(next)
        dfs(next, visited, result)
      }
    }
    for (const start of adj.keys()) {
      const acc = new Set<string>()
      dfs(start, new Set([start]), acc)
      closure.set(start, acc)
    }
    return closure
  }

  /** Two nodes are on the same relay chain iff one relay-reaches the other. */
  sameRelayChain(a: string, b: string): boolean {
    if (a === b) return true
    const reaches = this.getRelayReachability()
    return (reaches.get(a)?.has(b) ?? false) || (reaches.get(b)?.has(a) ?? false)
  }

  /**
   * Does the pair (a, b) have an underlying direct connection?
   * Same enabled mesh group, or a manual P2P_CONFIG entry between them.
   */
  hasUnderlyingConnection(a: string, b: string): boolean {
    return this.classifyConnection(a, b) === 'enabled'
  }

  /**
   * Classify the underlying connection between a and b:
   *  - 'enabled'  : same enabled mesh group, or manual P2P entry (takes effect)
   *  - 'disabled' : same mesh group but the group is ENABLED:false (exists but not active)
   *  - 'none'     : no relationship at all (declaration cannot apply — error)
   */
  classifyConnection(a: string, b: string): 'enabled' | 'disabled' | 'none' {
    let inDisabled = false
    for (const g of Object.values(normalizeMeshGroups(this.config.MESH_GROUPS))) {
      if (g.members.includes(a) && g.members.includes(b)) {
        if (g.enabled) return 'enabled'
        inDisabled = true
      }
    }
    if (this.config.EXTRA_CONFIG?.[a]?.P2P_CONFIG?.[b]) return 'enabled'
    return inDisabled ? 'disabled' : 'none'
  }

  /**
   * All enabled GATEWAY declarations (manual + Roaming flatten/nat expansion)
   * that have an underlying direct connection. A declaration with no underlying
   * connection does NOT take effect (no edge to attach to) and is reported by
   * health's "missing connections" check instead — it is excluded here so it
   * does not count toward gateway uniqueness.
   * Each {PUBLIC: exit A, PRIVATE: X} means X→A is a gateway edge.
   */
  getGatewayDeclarations(): Declaration[] {
    const hm = (this.config as any).HYBRID_MESH
    const list: Declaration[] = [...(hm?.DECLARATIONS?.GATEWAY || [])]
    for (const r of (hm?.ROAMING || []) as any[]) {
      if (r.ENABLED !== false) {
        list.push({ PUBLIC_PEER: r.PUBLIC_PEER, PRIVATE_PEER: r.PRIVATE_PEER, ENABLED: true })
      }
    }
    return list
      .filter(d => d.ENABLED !== false)
      .filter(d => this.hasUnderlyingConnection(d.PUBLIC_PEER, d.PRIVATE_PEER))
  }

  /**
   * Nodes that act as a gateway exit for X (X→A gateway). Used by health
   * gateway-uniqueness check. Returns the list of exit pubkeys A where
   * {PUBLIC:A, PRIVATE:X} is an enabled gateway declaration.
   */
  getGatewayExitsOf(x: string): string[] {
    return this.getGatewayDeclarations()
      .filter(d => d.PRIVATE_PEER === x)
      .map(d => d.PUBLIC_PEER)
  }

  /**
   * The set of peers that explicitly roam via another exit = PRIVATE_PEER of any
   * enabled GATEWAY/ROAMING declaration. Such a peer's implicit CENTER gateway
   * is disabled (X→CENTER falls back to CENTER's own host IP). Shared by
   * buildHistories (center-gateway stacking) + HybridMeshPanel (display).
   */
  getExplicitGatewayPrivates(): Set<string> {
    return new Set(this.getGatewayDeclarations().map(d => d.PRIVATE_PEER))
  }

  /**
   * Nodes that DIRECTLY relay X (X is PRIVATE of an enabled RELAY declaration
   * or flatten Roaming). Used by health relay-uniqueness check.
   *
   * IMPORTANT: only counts DIRECT relayers, not transitive. A relay chain
   * A→B→C means C is directly relayed by B only; A reaches C transitively
   * but is NOT a direct relayer of C. Transitive reach is legitimate (same
   * chain), not a uniqueness violation. A real violation is X being PRIVATE
   * of two independent relay declarations (two direct relayers not on the
   * same chain).
   */
  getDirectRelayersOf(x: string): string[] {
    const hm = (this.config as any).HYBRID_MESH
    const result: string[] = []
    const add = (pub: string) => {
      if (this.hasUnderlyingConnection(pub, x) && !result.includes(pub)) result.push(pub)
    }
    for (const d of (hm?.DECLARATIONS?.RELAY || []) as Declaration[]) {
      if (d.ENABLED !== false && d.PRIVATE_PEER === x) add(d.PUBLIC_PEER)
    }
    for (const r of (hm?.ROAMING || []) as any[]) {
      if (r.ENABLED !== false && r.TYPE === 'flatten' && r.PRIVATE_PEER === x) add(r.PUBLIC_PEER)
    }
    return result
  }
}
