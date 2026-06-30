// TopologyModel — single source of truth for topology semantics.
// Shared by renderModel (recording) and EasyWGSyncModel (health).
//
// CENTER model:
//   - CENTER is an ordinary peer by default (X→CENTER = CENTER's host IP).
//   - An implicit virtual Gateway stacks the domain network onto X→CENTER
//     unless X explicitly roams via another exit.
//   - CENTER is an implicit NAT proxy: traffic through CENTER has source
//     rewritten to CENTER's own IP (see tracePath).
//   - CENTER does NOT relay (no RELAY declarations name it).
//   - Domain network segment (v4 + v6) is derived from CENTER's
//     interfaceInfo.Address, masked to its network address.

import type { SyncConfig, Declaration } from '~/types'
import type { GraphBase } from '~/composables/useGraphDerive'
import { parseIPv6ToBigInt, bigIntToV6 } from '~/composables/useWgConfigParser'

export interface NormalizedGroup { members: string[]; enabled: boolean }

/**
 * Normalize MESH_GROUPS (handles legacy string[] and {PEERS,ENABLED} shapes).
 */
export function normalizeMeshGroups(mesh: Record<string, any> | undefined): Record<string, NormalizedGroup> {
  const out: Record<string, NormalizedGroup> = {}
  for (const [name, g] of Object.entries(mesh || {})) {
    if (Array.isArray(g)) out[name] = { members: g, enabled: true }
    else out[name] = { members: (g as any)?.PEERS || [], enabled: (g as any)?.ENABLED !== false }
  }
  return out
}

/** Mask v4 CIDR to network address, e.g. "192.168.222.1/24" → "192.168.222.0/24". */
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

/** Mask v6 CIDR to network address via BigInt 128-bit math. */
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
   * Domain networks (v4 + v6) — the whole network segment from CENTER's
   * interfaceInfo.Address (e.g. "192.168.222.1/24" → "192.168.222.0/24").
   * Falls back to first basePeer address only if interfaceInfo is unavailable.
   */
  getDomainNetworks(): { v4: string | null; v6: string | null } {
    let v4: string | null = null
    let v6: string | null = null
    // Primary: CENTER's interface Address (the network segment, e.g. /24).
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
   * CENTER's own /32 + /128 — its real interface IP. Authoritative source is
   * interfaceInfo.Address; falls back to the domain network base.
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
   * CENTER's dial endpoint — from globalDefaults.remote_endpoint + interfaceInfo.ListenPort.
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
   * Relay transitive closure: explicit RELAY + Roaming-flatten only.
   * CENTER is NOT included. Respects group ENABLED.
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
   * Same enabled mesh group ONLY. Per meshgroup-design-philosophy: only a
   * MeshGroup builds a connection; P2P_CONFIG is a per-viewer field override
   * on an existing edge and does NOT establish or revive connectionality
   * ("不建组可以允许存在关系——但是不会生效"). A P2P_CONFIG entry alone must not
   * count as a connection — otherwise declarations could attach to an edge that
   * exists neither on the canvas (deriveGraphData draws edges from MeshGroups)
   * nor in the .conf (config-generator emits [Peer] only from mesh members).
   */
  hasUnderlyingConnection(a: string, b: string): boolean {
    return this.classifyConnection(a, b) === 'enabled'
  }

  /**
   * Classify connection: enabled (same enabled group) / disabled (same group but
   * disabled) / none (no shared group). P2P_CONFIG is intentionally NOT consulted
   * — it overrides edge fields, never creates the edge itself.
   */
  classifyConnection(a: string, b: string): 'enabled' | 'disabled' | 'none' {
    let inDisabled = false
    for (const g of Object.values(normalizeMeshGroups(this.config.MESH_GROUPS))) {
      if (g.members.includes(a) && g.members.includes(b)) {
        if (g.enabled) return 'enabled'
        inDisabled = true
      }
    }
    return inDisabled ? 'disabled' : 'none'
  }

  /**
   * All enabled GATEWAY declarations (manual + Roaming expansion).
   * Excludes those with no underlying connection — they don't count toward uniqueness.
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
   * Peers that explicitly roam via another exit (= PRIVATE of any GATEWAY/ROAMING).
   * Their implicit CENTER gateway is disabled.
   */
  getExplicitGatewayPrivates(): Set<string> {
    return new Set(this.getGatewayDeclarations().map(d => d.PRIVATE_PEER))
  }

  /**
   * Direct relayers of X — only node that lists X as PRIVATE in a RELAY/flatten.
   * Transitive chain (A→B→C) is legitimate; only independent direct relayers violate.
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
