// composables/useHybridMesh.ts
//
// renderHybridMesh: pure function that expands HYBRID_MESH high-level intent
// declarations into concrete EXTRA_CONFIG fields (ALLOWED_IPS, P2P_CONFIG,
// SCRIPTS). Runs at config-read time, shared between frontend (useDraft) and
// backend (config-generator, graph.get).
//
// Design invariants:
//  - Pure: no Nuxt runtime, no fetch, no side effects. Input → output only.
//  - Never mutates the input config (deep-clone on entry).
//  - HYBRID_MESH is preserved in the output so callers can inspect the intent.
//  - @ syntax expansion is applied before HYBRID_MESH processing.
//  - Relay transitive closure uses BASE IP sets (not recursively rendered).
//  - ENABLED=false declarations are silently skipped.
//  - No HYBRID_MESH field → config returned unchanged (cloned, but unmodified).

import type { SyncConfig, PeerExtraConfig, HybridMesh, Declaration, RoamingEntry } from '~/types'
import type { GraphBase } from '~/composables/useGraphDerive'
import type { ScriptType } from '~/types'

// =========================================================================
// Helpers
// =========================================================================

/** Deep-clone via JSON round-trip. Safe for SyncConfig shapes (no Dates, etc.). */
function cloneConfig(cfg: SyncConfig): SyncConfig {
  return JSON.parse(JSON.stringify(cfg))
}

/** Ensure cfg.EXTRA_CONFIG[key] exists (on a clone) and return it. */
function ensureExtra(cfg: SyncConfig, pubkey: string): PeerExtraConfig {
  if (!cfg.EXTRA_CONFIG[pubkey]) {
    cfg.EXTRA_CONFIG[pubkey] = {}
  }
  return cfg.EXTRA_CONFIG[pubkey]
}

/**
 * Extract the full CIDR address strings from basePeers for a given pubkey.
 * Address field is "192.168.222.2/32, fd00:d00:721::2/128".
 * Returns e.g. ["192.168.222.2/32", "fd00:d00:721::2/128"].
 * CENTER node (not in basePeers) returns [].
 */
function getNodeOwnIPs(pubkey: string, base: GraphBase): string[] {
  for (const p of base.basePeers) {
    if (p.publicKey === pubkey) {
      if (!p.address) return []
      return p.address.split(',').map(s => s.trim()).filter(Boolean)
    }
  }
  return []
}

/**
 * Derive the canonical v4 /24 and v6 /80 network addresses from basePeer
 * addresses. The first peer with an IPv4 gives the /24; the first with an
 * IPv6 gives the /80. This mirrors the logic in useDraft.setAsGateway and
 * useGraphDerive.getCenterSegments.
 */
function getDomainNetworks(base: GraphBase): { v4: string | null; v6: string | null } {
  let v4: string | null = null
  let v6: string | null = null
  for (const p of base.basePeers) {
    if (!p.address) continue
    for (const cidr of p.address.split(',').map(s => s.trim())) {
      if (!v4 && cidr.includes('.')) {
        const m = cidr.match(/^([\d.]+)\/\d+$/)
        if (m) {
          const parts = m[1].split('.').map(Number)
          // unsigned 32-bit arithmetic to match JS bitwise behaviour
          const ip = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
          const mask = 0xffffff00 >>> 0 // /24
          const net = (ip & mask) >>> 0
          v4 = `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/24`
        }
      }
      if (!v6 && cidr.includes(':')) {
        // For v6 we simply replace the existing prefix with /80.
        v6 = cidr.replace(/\/\d+$/, '/80')
      }
    }
    if (v4 && v6) break
  }
  return { v4, v6 }
}

// =========================================================================
// @ syntax expansion (basic field layer, independent of HYBRID_MESH)
// =========================================================================

/**
 * Expand "@" entries in ALLOWED_IPS arrays.
 * "@" is replaced with the node's own real-address CIDRs from basePeers.
 * Operates in-place on a clone.
 */
function expandAtAllowedIPs(cfg: SyncConfig, base: GraphBase): void {
  for (const [pubkey, extra] of Object.entries(cfg.EXTRA_CONFIG)) {
    const ips = extra.ALLOWED_IPS
    if (!ips || !ips.includes('@')) continue
    const ownIPs = getNodeOwnIPs(pubkey, base)
    const expanded: string[] = []
    for (const entry of ips) {
      if (entry === '@') {
        for (const ip of ownIPs) expanded.push(ip)
      } else {
        expanded.push(entry)
      }
    }
    extra.ALLOWED_IPS = expanded
  }
}

/**
 * Expand "@ xxx" syntax in SCRIPTS fields.
 * "@ <content>" → GLOBAL_SCRIPTS[same field] + "\n" + <content>.
 * If there is no global script for that field, just the content is used.
 * Operates in-place on a clone.
 */
function expandAtScripts(cfg: SyncConfig): void {
  const globals = (cfg.GLOBAL_SCRIPTS || {}) as Record<string, string>
  for (const [, extra] of Object.entries(cfg.EXTRA_CONFIG)) {
    if (!extra.SCRIPTS) continue
    const keys = Object.keys(extra.SCRIPTS) as Array<keyof typeof extra.SCRIPTS>
    for (const key of keys) {
      const val = extra.SCRIPTS[key]
      if (typeof val !== 'string' || !val.startsWith('@')) continue
      const suffix = val.slice(1).trimStart() // everything after @, leading spaces stripped
      const globalPart = globals[key as string] || ''
      if (globalPart && suffix) {
        extra.SCRIPTS[key] = globalPart + '\n' + suffix
      } else if (globalPart) {
        extra.SCRIPTS[key] = globalPart
      } else {
        extra.SCRIPTS[key] = suffix
      }
    }
  }
}

// =========================================================================
// Relay transitive closure
// =========================================================================

/**
 * Build a directed relay graph from RELAY declarations.
 *
 * Each RELAY declaration `{PUBLIC_PEER: A, PRIVATE_PEER: B}` means
 *   "A relays B"  →  edge A → B in the relay graph.
 *
 * Returns `closure`: a Map from node pubkey → Set of pubkeys transitively
 * reachable from that node.  A node that does not appear as PUBLIC in any
 * enabled RELAY declaration will have an empty reachable set.
 *
 * Uses DFS with a visited-set per source — handles cycles safely.
 */
function computeRelayClosure(
  relayDecls: Declaration[],
): Map<string, Set<string>> {
  // Adjacency list: node → [nodes it directly relays]
  const adj = new Map<string, string[]>()

  for (const decl of relayDecls) {
    if (!decl.ENABLED) continue
    const from = decl.PUBLIC_PEER
    const to = decl.PRIVATE_PEER
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from)!.push(to)
    // Ensure target exists in map even if it has no outgoing edges.
    if (!adj.has(to)) adj.set(to, [])
  }

  const closure = new Map<string, Set<string>>()

  function dfs(node: string, visited: Set<string>, result: Set<string>): void {
    const neighbors = adj.get(node)
    if (!neighbors) return
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      result.add(neighbor)
      dfs(neighbor, visited, result)
    }
  }

  for (const node of adj.keys()) {
    const visited = new Set<string>()
    const reachable = new Set<string>()
    dfs(node, visited, reachable)
    closure.set(node, reachable)
  }

  return closure
}

// =========================================================================
// IP-set computation
// =========================================================================

/**
 * Compute the base IP set for a node BEFORE HYBRID_MESH rendering.
 *
 * IP set = the node's own real-address CIDRs (from basePeers)
 *        + the node's existing GLOBAL ALLOWED_IPS (from EXTRA_CONFIG).
 *
 * This is used as the "PRIVATE's IP set" when transitively propagating IPs
 * through the relay graph.  Because it is computed from the raw config
 * (not the recursively rendered one), the transitive closure is stable.
 */
function getBaseIPSet(pubkey: string, base: GraphBase, cfg: SyncConfig): Set<string> {
  const ipSet = new Set<string>()

  // 1. Own real-address CIDRs
  for (const ip of getNodeOwnIPs(pubkey, base)) {
    ipSet.add(ip)
  }

  // 2. Existing GLOBAL ALLOWED_IPS (may include manual overrides or previous @ expansion)
  const existing = cfg.EXTRA_CONFIG[pubkey]?.ALLOWED_IPS
  if (existing) {
    for (const ip of existing) {
      if (ip !== '@') ipSet.add(ip)
    }
  }

  return ipSet
}

// =========================================================================
// Main rendering function
// =========================================================================

/**
 * Render HYBRID_MESH high-level intent into concrete EXTRA_CONFIG fields.
 *
 * Processing order:
 * 1. If no HYBRID_MESH field → return deep-clone of input (no-op).
 * 2. Expand @ syntax in ALLOWED_IPS and SCRIPTS (independent layer).
 * 3. Expand ROAMING declarations into RELAY/PROXY/GATEWAY.
 * 4. Compute relay transitive closure and apply rendered ALLOWED_IPS.
 * 5. Apply GATEWAY declarations (PRIVATE→PUBLIC P2P_CONFIG.ALLOWED_IPS = /24 + /80).
 * 6. Apply PROXY declarations (PUBLIC SCRIPTS.PostUp += MASQUERADE placeholder).
 *
 * @param config  Raw persisted config (may contain HYBRID_MESH).
 * @param base    Read-only node → IP mapping from WGDashboard / graph.get.
 * @returns       A new config with HYBRID_MESH expanded into EXTRA_CONFIG.
 */
export function renderHybridMesh(config: SyncConfig, base: GraphBase): SyncConfig {
  // ---- backward compat: no HYBRID_MESH → return unchanged (but cloned) ----
  if (!config.HYBRID_MESH) {
    return cloneConfig(config)
  }

  // Deep-clone so we never mutate the caller's object.
  const out = cloneConfig(config)
  const hm = out.HYBRID_MESH!

  // ---- Step 0a: expand @ syntax in ALLOWED_IPS ----
  expandAtAllowedIPs(out, base)

  // ---- Step 0b: expand @ syntax in SCRIPTS ----
  expandAtScripts(out)

  // ---- collect universe of known pubkeys ----
  const knownPubkeys = new Set<string>()
  for (const p of base.basePeers) knownPubkeys.add(p.publicKey)
  if (base.centerPubKey) knownPubkeys.add(base.centerPubKey)
  for (const pk of Object.keys(out.EXTRA_CONFIG)) knownPubkeys.add(pk)

  // ---- Step 1: expand ROAMING → RELAY / PROXY / GATEWAY ----
  const relayDecls: Declaration[] = [...(hm.DECLARATIONS?.RELAY ?? [])]
  const proxyDecls: Declaration[] = [...(hm.DECLARATIONS?.PROXY ?? [])]
  const gatewayDecls: Declaration[] = [...(hm.DECLARATIONS?.GATEWAY ?? [])]

  for (const roaming of hm.ROAMING ?? []) {
    if (!roaming.ENABLED) continue
    const { PUBLIC_PEER, PRIVATE_PEER, TYPE } = roaming
    const decl: Declaration = { PUBLIC_PEER, PRIVATE_PEER, ENABLED: true }
    if (TYPE === 'flatten') {
      // flatten = no NAT  → RELAY + GATEWAY
      relayDecls.push(decl)
      gatewayDecls.push({ ...decl })
    } else {
      // nat = MASQUERADE → PROXY + GATEWAY
      proxyDecls.push(decl)
      gatewayDecls.push({ ...decl })
    }
  }

  // ---- Step 1b: dedup declarations (Roaming expansion may create duplicates) ----
  const dedupDecls = (arr: Declaration[]): Declaration[] => {
    const seen = new Set<string>()
    return arr.filter(d => {
      const key = `${d.PUBLIC_PEER}|${d.PRIVATE_PEER}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  const relayDeclsDedup = dedupDecls(relayDecls)
  const proxyDeclsDedup = dedupDecls(proxyDecls)
  const gatewayDeclsDedup = dedupDecls(gatewayDecls)

  // ---- Step 2: relay transitive closure ----

  // Pre-compute base IP sets for every known pubkey (before we mutate ALLOWED_IPS).
  // This is the "PRIVATE's IP set" used for transitive propagation.
  const baseIPSets = new Map<string, Set<string>>()
  for (const pk of knownPubkeys) {
    baseIPSets.set(pk, getBaseIPSet(pk, base, out))
  }

  const relayClosure = computeRelayClosure(relayDeclsDedup)

  // Apply relay rendering: for each node that has transitively reachable nodes,
  // append their IP sets to the node's ALLOWED_IPS.
  for (const [pubkey, reachable] of relayClosure) {
    if (reachable.size === 0) continue

    const extra = ensureExtra(out, pubkey)
    const existing = extra.ALLOWED_IPS

    // "Default" semantics: if existing ALLOWED_IPS is undefined or empty,
    // materialize the node's own real-address IPs first so the default
    // "advertise myself" behaviour is not lost.
    let rendered: string[]
    if (!existing || existing.length === 0) {
      rendered = [...getNodeOwnIPs(pubkey, base)]
    } else {
      rendered = [...existing]
    }

    // Union of IP sets from all transitively reachable nodes.
    const union = new Set<string>(rendered)
    for (const target of reachable) {
      const targetIPs = baseIPSets.get(target)
      if (targetIPs) {
        for (const ip of targetIPs) union.add(ip)
      }
    }

    extra.ALLOWED_IPS = [...union]
    // Ensure we also track this pubkey (it may not have been in EXTRA_CONFIG before).
    knownPubkeys.add(pubkey)
  }

  // ---- Step 3: GATEWAY ----
  // PRIVATE (B) → PUBLIC (A) edge: set ALLOWED_IPS to whole-domain /24 + /80.
  // Preserve any existing ENDPOINT / PERSISTENT_KEEPALIVE on that edge.
  const { v4, v6 } = getDomainNetworks(base)
  const domainIPs: string[] = []
  if (v4) domainIPs.push(v4)
  if (v6) domainIPs.push(v6)

  for (const gw of gatewayDeclsDedup) {
    if (!gw.ENABLED) continue
    const bNode = gw.PRIVATE_PEER  // the node that treats A as exit
    const aNode = gw.PUBLIC_PEER   // the exit node

    if (domainIPs.length === 0) continue // no network to set

    const extra = ensureExtra(out, bNode)
    if (!extra.P2P_CONFIG) extra.P2P_CONFIG = {}

    const existingEdge = extra.P2P_CONFIG[aNode] ?? {}
    extra.P2P_CONFIG[aNode] = {
      ...existingEdge,
      ALLOWED_IPS: [...domainIPs],
    }

    knownPubkeys.add(bNode)
  }

  // ---- Step 4: PROXY ----
  // PUBLIC's SCRIPTS get permissive forwarding + MASQUERADE (Fullcone-like for WG).
  // - FORWARD -i/-o %i ACCEPT: allow traffic to enter/leave the WG interface
  // - INPUT -i %i ACCEPT: accept inbound from WG (loosest inbound policy)
  // - POSTROUTING -o %i MASQUERADE: NAT outbound through WG (allows any exit)
  // Idempotent: checks for marker to avoid duplicate rules.
  const PROXY_MARKER = '[EasyWGSync PROXY] fullcone rules:'
  const PROXY_POSTUP   = [
    'iptables -A FORWARD -i %i -j ACCEPT',
    'iptables -A FORWARD -o %i -j ACCEPT',
    'iptables -A INPUT   -i %i -j ACCEPT',
    'iptables -t nat -A POSTROUTING -o %i -j MASQUERADE',
  ].join('; ')
  const PROXY_POSTDOWN = [
    'iptables -D FORWARD -i %i -j ACCEPT',
    'iptables -D FORWARD -o %i -j ACCEPT',
    'iptables -D INPUT   -i %i -j ACCEPT',
    'iptables -t nat -D POSTROUTING -o %i -j MASQUERADE',
  ].join('; ')

  for (const proxy of proxyDeclsDedup) {
    if (!proxy.ENABLED) continue
    const aNode = proxy.PUBLIC_PEER

    const extra = ensureExtra(out, aNode)
    if (!extra.SCRIPTS) extra.SCRIPTS = {}

    const mark   = `# ${PROXY_MARKER}`
    const exUp   = extra.SCRIPTS.PostUp   || ''
    const exDown = extra.SCRIPTS.PostDown || ''

    if (!exUp.includes(PROXY_MARKER)) {
      extra.SCRIPTS.PostUp   = exUp   ? `${exUp}\n${mark}\n${PROXY_POSTUP}`   : `${mark}\n${PROXY_POSTUP}`
    }
    if (!exDown.includes(PROXY_MARKER)) {
      extra.SCRIPTS.PostDown = exDown ? `${exDown}\n${mark}\n${PROXY_POSTDOWN}` : `${mark}\n${PROXY_POSTDOWN}`
    }

    knownPubkeys.add(aNode)
  }

  return out
}

// =========================================================================
// Intent manipulation helpers (used by useDraft)
// =========================================================================

function emptyHybridMesh(): HybridMesh {
  return { DECLARATIONS: { RELAY: [], PROXY: [], GATEWAY: [] }, ROAMING: [] }
}

export function addDeclaration(
  hm: HybridMesh | undefined,
  kind: 'RELAY' | 'PROXY' | 'GATEWAY',
  pub: string,
  priv: string
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm, DECLARATIONS: { ...hm.DECLARATIONS }, ROAMING: [...(hm.ROAMING || [])] } as any) as HybridMesh : emptyHybridMesh()
  if (!out.DECLARATIONS) out.DECLARATIONS = { RELAY: [], PROXY: [], GATEWAY: [] }
  if (!out.DECLARATIONS[kind]) out.DECLARATIONS[kind] = []
  const list = out.DECLARATIONS[kind]!
  if (!list.some(d => d.PUBLIC_PEER === pub && d.PRIVATE_PEER === priv)) {
    list.push({ PUBLIC_PEER: pub, PRIVATE_PEER: priv, ENABLED: true })
  }
  return out
}

export function removeDeclaration(
  hm: HybridMesh | undefined,
  kind: 'RELAY' | 'PROXY' | 'GATEWAY',
  pub: string,
  priv: string
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm } as any) as HybridMesh : emptyHybridMesh()
  if (out.DECLARATIONS?.[kind]) {
    out.DECLARATIONS[kind] = out.DECLARATIONS[kind]!.filter(
      d => !(d.PUBLIC_PEER === pub && d.PRIVATE_PEER === priv)
    )
  }
  return out
}

export function addRoaming(
  hm: HybridMesh | undefined,
  pub: string,
  priv: string,
  type: 'flatten' | 'nat'
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm } as any) as HybridMesh : emptyHybridMesh()
  if (!out.ROAMING) out.ROAMING = []
  if (!out.ROAMING.some(r => r.PUBLIC_PEER === pub && r.PRIVATE_PEER === priv)) {
    out.ROAMING.push({ PUBLIC_PEER: pub, PRIVATE_PEER: priv, ENABLED: true, TYPE: type })
  }
  return out
}

export function removeRoaming(
  hm: HybridMesh | undefined,
  pub: string,
  priv: string
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm } as any) as HybridMesh : emptyHybridMesh()
  if (out.ROAMING) {
    out.ROAMING = out.ROAMING.filter(
      r => !(r.PUBLIC_PEER === pub && r.PRIVATE_PEER === priv)
    )
  }
  return out
}
