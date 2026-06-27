// composables/useHealthFull.ts
//
// DYNAMIC ("完整") health check — renders every node's REAL generated config
// (via /api/admin/mock-config from the current draft) and inspects the actual
// routing tables from each node's own perspective. This is the heavy O(n²)
// check, triggered manually (not on every draft change).
//
// Two checks:
//   1. duplicates  — within a single node's config, the SAME AllowedIPs entry
//                    (exact string, NOT prefix coverage) appears in 2+ peers, so
//                    WireGuard cannot decide which peer owns that route.
//   2. unreachable — for every ordered pair (src → tgt), simulate longest-prefix
//                    routing through the rendered configs (multi-hop). ONE-WAY
//                    only (no return-path / symmetry check). Report pairs the
//                    source cannot route to.

import { parseWireGuardConfig, tracePath, centerRoutingConfig, extractIP, extractCenterOwnIPs, buildPubkeyToId, type ParsedWireGuardConfig } from '~/composables/useWgConfigParser'
import { useDraft } from '~/composables/useDraft'
import { authFetch } from '~/composables/useAuth'
import type { SyncConfig } from '~/types'

/**
 * Fetch one peer's rendered WireGuard config (via /api/admin/mock-config) and
 * parse it. Returns null on fetch failure / empty config. Shared by health
 * (parallel batch) + TraceRoutePanel (per-hop on demand). CENTER handling is
 * the caller's concern (CENTER has no peer .conf — use centerRoutingConfig).
 */
export async function fetchParsedConfig(peerName: string, draft: SyncConfig): Promise<ParsedWireGuardConfig | null> {
  try {
    const res = await authFetch('/api/admin/mock-config', {
      method: 'POST',
      body: { config: draft, peerName },
    }) as { config: string }
    if (!res?.config) return null
    return parseWireGuardConfig(res.config)
  } catch {
    return null
  }
}

export interface DuplicateFinding {
  node: string
  nodeName: string
  ip: string
  peers: Array<{ id: string; name: string }>
}

export interface UnreachableFinding {
  src: string
  srcName: string
  tgt: string
  tgtName: string
  reason: string
}

export interface FullHealthResult {
  duplicates: DuplicateFinding[]
  unreachable: UnreachableFinding[]
  /** node ids whose config failed to generate (excluded from checks). */
  failed: Array<{ id: string; name: string }>
}

interface NodeMeta {
  id: string
  name: string
  pubkey: string
  ipv4: string | null   // bare IPv4 (no /prefix), for trace targets
  ipv6: string | null   // bare IPv6 (no /prefix), for trace targets
}

/**
 * Run the dynamic full health check against the current draft.
 * Fetches each peer node's rendered .conf once (parallel), then inspects.
 */
export async function runFullHealthCheck(graphData: any): Promise<FullHealthResult> {
  const draftStore = useDraft()
  const nodes: any[] = graphData?.nodes || []

  // Peer nodes only (CENTER has no generatable peer .conf and address = 'ALL').
  const peers: NodeMeta[] = nodes
    .filter(n => !n.data?.isCenter && n.data?.fileName)
    .map(n => {
      const addr: string = n.data?.address || ''
      return {
        id: n.id,
        name: n.data?.fileName || n.id.slice(0, 12),
        pubkey: n.data?.publicKey || n.id,
        ipv4: extractIP(addr, 'v4'),
        ipv6: extractIP(addr, 'v6'),
      }
    })

  const nameOf = (id: string) => peers.find(p => p.id === id)?.name || id.slice(0, 12)
  const pubkeyToId = buildPubkeyToId(nodes)

  const configs = new Map<string, ParsedWireGuardConfig>()
  const failed: Array<{ id: string; name: string }> = []
  await Promise.all(peers.map(async (p) => {
    const conf = await fetchParsedConfig(p.name, draftStore.draft.value)
    if (conf) configs.set(p.id, conf)
    else failed.push({ id: p.id, name: p.name })
  }))

  // CENTER is the WG hub: it has a [Peer] for every node (each /32) and thus
  // covers the whole domain. Model that real routing table (shared builder) and
  // add it to the config map + pubkey index, so a trace landing on CENTER routes
  // on to the destination peer — no hardcoded "reaching CENTER = done" shortcut.
  // CENTER NAT: a packet forwarded out of CENTER has its source rewritten to
  // CENTER's own IPv4 (MASQUERADE). Used by tracePath.
  const centerNode = nodes.find(n => n.data?.isCenter)
  let centerId: string | undefined
  let centerOwnIpV4: string | undefined
  let centerOwnIpV6: string | undefined
  if (centerNode) {
    configs.set(centerNode.id, centerRoutingConfig(nodes))
    centerId = centerNode.id
    const own = extractCenterOwnIPs(centerNode.data?.ownIPs)
    centerOwnIpV4 = own.v4 || undefined
    centerOwnIpV6 = own.v6 || undefined
  }

  // --- Check 1: exact-duplicate AllowedIPs within a single node's config ---
  const duplicates: DuplicateFinding[] = []
  for (const p of peers) {
    const conf = configs.get(p.id)
    if (!conf) continue
    // ip(exact CIDR string) → set of peer pubkeys that declare it
    const byCidr = new Map<string, Set<string>>()
    for (const [pubkey, peer] of conf.peers) {
      for (const cidr of peer.allowedIPs) {
        const norm = cidr.trim()
        if (!norm) continue
        if (!byCidr.has(norm)) byCidr.set(norm, new Set())
        byCidr.get(norm)!.add(pubkey)
      }
    }
    for (const [cidr, pubkeys] of byCidr) {
      if (pubkeys.size < 2) continue   // coverage (different CIDRs) is fine — only exact dups count
      duplicates.push({
        node: p.id,
        nodeName: p.name,
        ip: cidr,
        peers: [...pubkeys].map(pk => ({ id: pubkeyToId.get(pk) || pk, name: nameOf(pubkeyToId.get(pk) || pk) })),
      })
    }
  }

  // --- Check 2: O(n²) reachability — bidirectional per family, asymmetric is OK ---
  // For each family (v4, v6) both peers have, BOTH directions must resolve
  // (forward src→tgt and return tgt→src). Asymmetric paths are NOT errors here
  // (NAT through CENTER makes asymmetry legitimate); only a dead direction
  // reports. Each direction models CENTER-NAT (source → CENTER's own IP on
  // egress) + cryptokey source-acceptance.
  const unreachable: UnreachableFinding[] = []
  const checkPair = async (src: NodeMeta, tgt: NodeMeta, family: 'v4' | 'v6') => {
    const srcIp = family === 'v4' ? src.ipv4 : src.ipv6
    const tgtIp = family === 'v4' ? tgt.ipv4 : tgt.ipv6
    if (!srcIp || !tgtIp) return
    const getConfig = (id: string) => configs.get(id) || null
    const fwd = await tracePath({ sourceId: src.id, targetIp: tgtIp, getConfig, pubkeyToId, centerId, centerOwnIpV4, centerOwnIpV6, sourceIp: srcIp })
    if (!fwd.ok) {
      unreachable.push({ src: src.id, srcName: src.name, tgt: tgt.id, tgtName: tgt.name, reason: `${family} 去程：${fwd.reason}` })
      return
    }
    const ret = await tracePath({ sourceId: tgt.id, targetIp: srcIp, getConfig, pubkeyToId, centerId, centerOwnIpV4, centerOwnIpV6, sourceIp: tgtIp })
    if (!ret.ok) {
      unreachable.push({ src: src.id, srcName: src.name, tgt: tgt.id, tgtName: tgt.name, reason: `${family} 回程：${ret.reason}` })
    }
  }
  for (const src of peers) {
    if (!configs.has(src.id)) continue
    for (const tgt of peers) {
      if (src.id === tgt.id || !configs.has(tgt.id)) continue
      await checkPair(src, tgt, 'v4')
      await checkPair(src, tgt, 'v6')
    }
  }

  return { duplicates, unreachable, failed }
}
