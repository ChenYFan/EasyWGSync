// Parse a WireGuard .conf text into a routing table for mock trace.
// Returns: { ownIPs: string[], peers: Map<pubkey, { allowedIPs: string[], endpoint?: string }> }

export interface ParsedPeer {
  allowedIPs: string[]
  endpoint?: string
  publicKey?: string
  comments?: string
}

export interface ParsedWireGuardConfig {
  ownIPs: string[]
  peers: Map<string, ParsedPeer> // keyed by PublicKey
}

export function parseWireGuardConfig(conf: string): ParsedWireGuardConfig {
  const ownIPs: string[] = []
  const peers = new Map<string, ParsedPeer>()

  const lines = conf.split('\n')
  let currentSection: string | null = null
  let currentPeer: ParsedPeer | null = null
  let currentPubKey: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      if (currentPeer && currentPubKey) {
        peers.set(currentPubKey, currentPeer)
      }
      currentSection = sectionMatch[1]
      currentPeer = null
      currentPubKey = null
      if (currentSection === 'Peer') {
        currentPeer = { allowedIPs: [] }
      }
      continue
    }

    const kvMatch = line.match(/^([A-Za-z_#]+)\s*=\s*(.+)$/)
    if (!kvMatch) continue
    const key = kvMatch[1].trim()
    const value = kvMatch[2].trim()

    if (currentSection === 'Interface') {
      if (key === 'Address') {
        ownIPs.push(...value.split(',').map(s => s.trim()))
      }
    } else if (currentSection === 'Peer' && currentPeer) {
      if (key === 'PublicKey') {
        currentPubKey = value
        currentPeer.publicKey = value
      } else if (key === 'AllowedIPs') {
        currentPeer.allowedIPs.push(...value.split(',').map(s => s.trim()))
      } else if (key === 'Endpoint') {
        currentPeer.endpoint = value
      } else if (key === '#Comments') {
        currentPeer.comments = value
      }
    }
  }

  if (currentPeer && currentPubKey) {
    peers.set(currentPubKey, currentPeer)
  }

  return { ownIPs, peers }
}

/**
 * CENTER's routing table for trace/reachability. CENTER is the WG interface
 * itself — it has NO peer .conf to generate, but its wg0.conf holds a [Peer]
 * for every node (each pinned to its own /32). Build that table from the graph
 * nodes so a trace landing on CENTER routes to the destination peer (covering
 * the whole domain), instead of dead-ending. Shared by health + TraceRoute so
 * both model CENTER identically.
 *
 * `ownIPs` (CENTER's own interface IP, stamped on the CENTER node by
 * deriveGraphData from interfaceInfo.Address) is read off the node so a trace
 * TARGETING CENTER itself terminates (CENTER owns that IP) instead of finding
 * no covering route.
 */
export function centerRoutingConfig(nodes: any[]): ParsedWireGuardConfig {
  const peers = new Map<string, ParsedPeer>()
  let ownIPs: string[] = []
  for (const n of nodes || []) {
    if (n.data?.isCenter) { ownIPs = n.data?.ownIPs || []; continue }
    const pubkey = n.data?.publicKey || n.id
    const allowedIPs = String(n.data?.address || '')
      .split(',').map(s => s.trim()).filter(Boolean)
      .map(a => a.replace(/\/\d+$/, '') + (a.includes(':') ? '/128' : '/32'))   // pin each peer to its host route
    if (allowedIPs.length) peers.set(pubkey, { allowedIPs, publicKey: pubkey })
  }
  return { ownIPs: [...ownIPs], peers }
}

/**
 * One routing decision at a node, shared by every trace (health + TraceRoute):
 *  - { reached } : this node owns the target IP (destination).
 *  - { pubkey, cidr } : longest-prefix next hop (cidr = matched route, for display).
 *  - { ambiguous, cidr, pubkeys } : 2+ peers advertise the SAME most-specific
 *    range covering the target — a genuine duplicate-route conflict the node
 *    cannot resolve. (Containment, e.g. /24 vs /32, is NOT a conflict: the
 *    longest prefix / smallest range wins. Only an EXACT-equal winning range
 *    across distinct peers is ambiguous.)
 *  - { fail } : no peer covers the target.
 *
 * Uses only what a real router knows at this hop — the per-peer AllowedIPs — and
 * no global "who really owns this IP" knowledge.
 */
export type RouteStep =
  | { reached: true }
  | { pubkey: string; cidr: string }
  | { ambiguous: true; cidr: string; pubkeys: string[] }
  | { fail: true }
export function routeStep(conf: ParsedWireGuardConfig, targetIp: string): RouteStep {
  const isV6 = targetIp.includes(':')
  const inCidr = isV6 ? ipv6InCIDR : ipv4InCIDR
  // ownIPs: this node owns the target IP (destination reached)?
  for (const ip of conf.ownIPs) {
    if (isV6 ? ip.includes(':') : ip.includes('.')) {
      if (inCidr(targetIp, ip)) return { reached: true }
    }
  }
  // Collect the peers matching at the LONGEST prefix. At a fixed prefix length
  // the network containing targetIp is unique, so 2+ distinct peers here means
  // they advertise the identical winning range → duplicate-route conflict.
  let bestPrefix = -1
  let bestCidr = ''
  const pubkeys: string[] = []
  for (const [pubkey, peer] of conf.peers) {
    for (const cidr of peer.allowedIPs) {
      if (isV6 ? !cidr.includes(':') : !cidr.includes('.')) continue
      if (!inCidr(targetIp, cidr)) continue
      const prefix = getCIDRPrefix(cidr)
      if (prefix > bestPrefix) {
        bestPrefix = prefix
        bestCidr = cidr
        pubkeys.length = 0
        pubkeys.push(pubkey)
      } else if (prefix === bestPrefix && !pubkeys.includes(pubkey)) {
        pubkeys.push(pubkey)
      }
    }
  }
  if (bestPrefix < 0) return { fail: true }
  if (pubkeys.length > 1) return { ambiguous: true, cidr: bestCidr, pubkeys: [...pubkeys] }
  return { pubkey: pubkeys[0], cidr: bestCidr }
}

/**
 * Does `conf` have any peer whose AllowedIPs covers `sourceIp`? Models WireGuard
 * cryptokey inbound filtering: a node accepts a packet only if some peer's
 * AllowedIPs covers the source IP. (NAT'd sources — e.g. CENTER's .0 after a
 * NAT hop — are checked against the same rule.)
 */
export function acceptsSource(conf: ParsedWireGuardConfig, sourceIp: string): boolean {
  const isV6 = sourceIp.includes(':')
  const inCidr = isV6 ? ipv6InCIDR : ipv4InCIDR
  for (const peer of conf.peers.values()) {
    for (const cidr of peer.allowedIPs) {
      if (isV6 ? cidr.includes(':') : cidr.includes('.')) {
        if (inCidr(sourceIp, cidr)) return true
      }
    }
  }
  return false
}

/**
 * Trace a packet from `sourceId` toward `targetIp`, hop by hop, tracking the
 * source IP. CENTER is an implicit NAT proxy: a packet forwarded OUT of CENTER
 * has its source IP rewritten to `centerOwnIp` (MASQUERADE). On reaching the
 * destination, the destination must accept the (possibly NAT'd) source IP via
 * cryptokey (acceptsSource) — else the trace fails.
 *
 * Returns the hop node ids (for display) + ok/reason. Shared by health +
 * TraceRoutePanel so both model CENTER-NAT + source-acceptance identically.
 */
export interface TracePathOpts {
  sourceId: string
  targetIp: string
  /** Per-node config getter (async — may fetch on demand or read a cache). */
  getConfig: (nodeId: string) => Promise<ParsedWireGuardConfig | null> | ParsedWireGuardConfig | null
  /** pubkey → node id (to resolve routeStep's next-hop pubkey back to a node). */
  pubkeyToId: Map<string, string>
  /** CENTER node id (NAT proxy). undefined if no CENTER. */
  centerId?: string
  /** CENTER's own IPv4 (the v4 NAT source). undefined if no CENTER / no v4. */
  centerOwnIpV4?: string
  /** CENTER's own IPv6 (the v6 NAT source). undefined if no CENTER / no v6. */
  centerOwnIpV6?: string
  /** Initial source IP (the originator's IP, same family as targetIp). */
  sourceIp: string
  maxHops?: number
}
export interface TraceHop { nodeId: string; cidr: string | null }
export async function tracePath(opts: TracePathOpts): Promise<{ ok: true; hops: TraceHop[] } | { ok: false; reason: string; hops: TraceHop[] }> {
  const { sourceId, targetIp, getConfig, pubkeyToId, sourceIp, maxHops = 16 } = opts
  const hops: TraceHop[] = [{ nodeId: sourceId, cidr: null }]
  let currentId = sourceId
  let curSourceIp = sourceIp
  const visited = new Set<string>()

  for (let i = 0; i < maxHops; i++) {
    const conf = await getConfig(currentId)
    if (!conf) return { ok: false, reason: `无法生成中间节点配置`, hops }

    const step = routeStep(conf, targetIp)
    if ('reached' in step) {
      // Destination owns targetIp. It must accept the (possibly NAT'd) source IP.
      if (!acceptsSource(conf, curSourceIp)) {
        return { ok: false, reason: `目的节点不接受源 ${curSourceIp}`, hops }
      }
      return { ok: true, hops }
    }
    if (visited.has(currentId)) return { ok: false, reason: `路由环路`, hops }
    visited.add(currentId)
    if ('fail' in step) return { ok: false, reason: `无覆盖 ${targetIp} 的路由`, hops }
    if ('ambiguous' in step) return { ok: false, reason: `重复路由：多个节点声明了相同范围 ${step.cidr}`, hops }

    const nextId = pubkeyToId.get(step.pubkey)
    if (!nextId) return { ok: false, reason: `下一跳节点未知`, hops }

    // CENTER NAT: a packet forwarded OUT of CENTER has its source rewritten to
    // CENTER's own IP (MASQUERADE on the WG interface) — same family as the
    // target (v4 traffic → CENTER v4, v6 traffic → CENTER v6).
    if (opts.centerId && currentId === opts.centerId) {
      const isV6 = targetIp.includes(':')
      const nat = isV6 ? opts.centerOwnIpV6 : opts.centerOwnIpV4
      if (nat) curSourceIp = nat
    }
    currentId = nextId
    hops.push({ nodeId: currentId, cidr: step.cidr })
  }
  return { ok: false, reason: `超过最大跳数`, hops }
}

export function ipv4InCIDR(ip: string, cidr: string): boolean {
  const target = parseIPv4(ip)
  const network = parseCIDR(cidr)
  if (!target || !network) return false
  const mask = network.prefix === 0 ? 0 : (~0 << (32 - network.prefix)) >>> 0
  return ((target >>> 0) & mask) === ((network.ip >>> 0) & mask)
}

function parseIPv4(ip: string): number | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number)
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

function parseCIDR(cidr: string): { ip: number; prefix: number } | null {
  const m = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/)
  if (!m) return null
  const ip = parseIPv4(m[1])
  if (ip === null) return null
  return { ip, prefix: parseInt(m[2]) }
}

/**
 * Is `ip` (a bare IPv6 address) inside `cidr` (an IPv6 CIDR)? 128-bit math via
 * BigInt. Handles `::` compression and embedded-IPv4 tails. Mirrors ipv4InCIDR.
 */
export function ipv6InCIDR(ip: string, cidr: string): boolean {
  const target = parseIPv6ToBigInt(ip)
  const net = parseCIDRv6(cidr)
  if (target === null || net === null) return false
  if (net.prefix === 0) return true
  const mask = ((1n << BigInt(net.prefix)) - 1n) << BigInt(128 - net.prefix)
  return (target & mask) === (net.ip & mask)
}

/** Parse a bare IPv6 address to a 128-bit BigInt. Returns null if malformed.
 *  Handles `::` compression and embedded-IPv4 tails. Single source for v6
 *  parsing (used by ipv6InCIDR here + maskV6 in useTopology). */
export function parseIPv6ToBigInt(addr: string): bigint | null {
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const hextet = /^[0-9a-fA-F]{1,4}$/
  const runToGroups = (run: string): bigint[] | null => {
    if (run === '') return []
    const segs = run.split(':')
    const out: bigint[] = []
    for (const s of segs) {
      if (s.includes('.')) {
        if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s)) return null
        const parts = s.split('.').map(Number)
        if (parts.some(o => o > 255)) return null
        out.push(BigInt((parts[0] << 8) | parts[1]))
        out.push(BigInt((parts[2] << 8) | parts[3]))
      } else {
        if (!hextet.test(s)) return null
        out.push(BigInt(parseInt(s, 16)))
      }
    }
    return out
  }
  const fold = (groups: bigint[]): bigint => {
    let v = 0n
    for (const g of groups) v = (v << 16n) | g
    return v
  }
  let left: bigint[] = []
  let right: bigint[] = []
  if (halves.length === 2) {
    const lg = runToGroups(halves[0])
    const rg = runToGroups(halves[1])
    if (lg === null || rg === null) return null
    left = lg; right = rg
    const total = left.length + right.length
    if (total > 8) return null
    const fill = 8 - total
    return fold([...left, ...new Array(fill).fill(0n), ...right])
  }
  const g = runToGroups(halves[0])
  if (g === null || g.length !== 8) return null
  return fold(g)
}

/** Compress a 128-bit BigInt to canonical v6 text (with '::' for the longest
 *  zero run). Reverse of parseIPv6ToBigInt. Single source (used by maskV6). */
export function bigIntToV6(net: bigint): string {
  const groups: number[] = []
  let v = net
  for (let i = 0; i < 8; i++) {
    groups.unshift(Number(v & 0xFFFFn))
    v >>= 16n
  }
  // Find the longest run of zero groups (>=2) for '::'.
  let bestStart = -1, bestLen = 0
  let curStart = -1, curLen = 0
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart < 0) curStart = i
      curLen++
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart }
    } else {
      curStart = -1; curLen = 0
    }
  }
  const hex = groups.map(g => g.toString(16))
  if (bestLen >= 2) {
    const before = hex.slice(0, bestStart).join(':')
    const after = hex.slice(bestStart + bestLen).join(':')
    if (bestStart === 0 && bestStart + bestLen === 8) return '::'
    if (bestStart === 0) return `::${after}`
    if (bestStart + bestLen === 8) return `${before}::`
    return `${before}::${after}`
  }
  return hex.join(':')
}

function parseCIDRv6(cidr: string): { ip: bigint; prefix: number } | null {
  const slash = cidr.lastIndexOf('/')
  if (slash < 0) return { ip: parseIPv6ToBigInt(cidr)!, prefix: 128 }
  const ip = parseIPv6ToBigInt(cidr.slice(0, slash))
  const prefix = Number(cidr.slice(slash + 1))
  if (ip === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null
  return { ip, prefix }
}

export function getCIDRPrefix(cidr: string): number {
  const m = cidr.match(/\/(\d+)$/)
  return m ? parseInt(m[1]) : 32
}

// =========================================================================
// IP / CIDR classification — validate a token as a real IPv4 or IPv6 address
// (optionally with a CIDR prefix), rather than guessing by "contains a dot".
// =========================================================================

/** A single dotted-quad, each octet 0-255, no leading-zero ambiguity beyond 1-3 digits. */
function isIPv4Address(s: string): boolean {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  return m.slice(1).every(o => Number(o) <= 255)
}

/** Valid IPv4, optionally with a /0-32 prefix. */
export function isIPv4(s: string): boolean {
  const t = s.trim()
  const slash = t.indexOf('/')
  if (slash === -1) return isIPv4Address(t)
  const prefix = t.slice(slash + 1)
  if (!/^\d{1,2}$/.test(prefix) || Number(prefix) > 32) return false
  return isIPv4Address(t.slice(0, slash))
}

/** Valid IPv6 address (handles `::` compression + embedded IPv4 tail). */
function isIPv6Address(addr: string): boolean {
  if (!addr) return false
  const halves = addr.split('::')
  if (halves.length > 2) return false                 // at most one '::'
  const hextet = /^[0-9a-fA-F]{1,4}$/
  // Count the 16-bit groups in a colon-separated run; an embedded IPv4 tail
  // (e.g. ::ffff:1.2.3.4) counts as 2 groups. Returns -1 if malformed.
  const countGroups = (run: string): number => {
    if (run === '') return 0
    const segs = run.split(':')
    let n = 0
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      if (i === segs.length - 1 && seg.includes('.')) {
        if (!isIPv4Address(seg)) return -1
        n += 2
      } else if (hextet.test(seg)) {
        n += 1
      } else {
        return -1
      }
    }
    return n
  }
  if (halves.length === 2) {
    const l = countGroups(halves[0])
    const r = countGroups(halves[1])
    if (l < 0 || r < 0) return false
    return l + r <= 7                                  // '::' fills >=1 zero group
  }
  return countGroups(addr) === 8
}

/** Valid IPv6, optionally with a /0-128 prefix. */
export function isIPv6(s: string): boolean {
  const t = s.trim()
  const slash = t.indexOf('/')
  if (slash === -1) return isIPv6Address(t)
  const prefix = t.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > 128) return false
  return isIPv6Address(t.slice(0, slash))
}

/** Classify a token as a valid IPv4 / IPv6 (with optional CIDR), or null if neither. */
export function classifyIP(s: string): 'v4' | 'v6' | null {
  if (isIPv4(s)) return 'v4'
  if (isIPv6(s)) return 'v6'
  return null
}

/**
 * Extract the first bare IP (no /prefix) of the given family from a
 * comma-joined address field (e.g. a node's `address`). Validates each token
 * with classifyIP (so an IPv6-with-embedded-IPv4-tail like `::ffff:1.2.3.4` is
 * NOT misclassified as v4). Single source for the v4/v6-from-address pattern
 * used by health, TraceRoutePanel, and EasyWGSyncModel.getRealIPv4/v6.
 */
export function extractIP(addressStr: string, family: 'v4' | 'v6'): string | null {
  const parts = (addressStr || '').split(',').map(s => s.trim()).filter(Boolean)
  for (const p of parts) {
    if (classifyIP(p) === family) return p.replace(/\/\d+$/, '')
  }
  return null
}

/**
 * Extract CENTER's own v4 + v6 bare IPs from its stamped `ownIPs` array
 * (each entry is a host route like "192.168.222.1/32" or "fd00::1/128"). Returns
 * { v4, v6 } (either may be null). Single source for the NAT-source extraction
 * used by health + TraceRoutePanel.
 */
export function extractCenterOwnIPs(ownIPs: string[] | undefined): { v4: string | null; v6: string | null } {
  const joined = (ownIPs || []).join(',')
  return { v4: extractIP(joined, 'v4'), v6: extractIP(joined, 'v6') }
}

/**
 * Build a pubkey → node-id map by scanning graph nodes (each node's
 * `data.publicKey`). Single source for the pubkeyToId map used by tracePath's
 * callers (health + TraceRoutePanel) to resolve next-hop pubkeys back to nodes.
 */
export function buildPubkeyToId(nodes: any[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const n of nodes) {
    const pk = n?.data?.publicKey
    if (pk) m.set(pk, n.id)
  }
  return m
}
