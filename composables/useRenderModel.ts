// composables/useRenderModel.ts
//
// Single convergence capability for the whole config. Every field of a
// Peer/Connection is modeled as an ordered CHANGELOG (FieldHistory): each layer
// (default → extra → declaration) pushes modification records in application
// order. `converge()` is the ONE pure fold that turns a changelog into a final
// value — it does NOT query topology, the graph, or re-render anything.
//
// All generation (Peer .conf, Connection config, graph edge values, panel
// preview) reads the converged result. Queries (topology / relay closure /
// gateway detection) happen only in the recording phase (buildHistories, added
// in a later step), never here.

export type Layer = 'default' | 'extra' | 'declaration'

// override = replace accumulated; append = add on top (@); none = delete key.
export type Op = 'override' | 'append' | 'none'

export interface Mod {
  layer: Layer
  op: Op
  value: string            // the change's content (joined string; ignored for 'none')
  origin?: string          // who made it: 'conf' | 'manual' | 'gateway:<A>' | 'relay:<R>' | 'proxy:<P>' | 'center-gateway' | 'global'
}

export type FieldHistory = Mod[]

export interface Converged {
  final: string | null     // folded final value; null = key deleted / nothing
  history: DisplayMod[]     // the (non-empty) records that participated, in order
  deleted: boolean         // a surviving 'none' deleted the key
}

/** A participating record annotated for display (struck if later replaced). */
export interface DisplayMod extends Mod {
  superseded: boolean      // a LATER record (override/none) replaced this one
}

/**
 * The ONE convergence function. Pure fold over an ordered changelog.
 *   override → acc = value (replace)
 *   append   → acc = acc + sep + value (add; acc empty → value)
 *   none     → mark deleted
 *
 * MANUAL SINK: before folding, every record with layer 'extra' (manual edits)
 * is shifted — preserving relative order — to the END of the list. So a node's
 * own manual declaration always applies on top of everything it inherited from
 * the other peer's history + declarations, regardless of where it was recorded.
 * op is NOT inspected here (override sinks the same as append); if the user
 * chose override, it simply wipes the accumulated value — their call.
 *
 * 'none' has lowest priority: it is resolved by the running fold like any other
 * record (a later override/append revives the key); only a SURVIVING delete at
 * the end yields final = null.
 */
export function converge(history: FieldHistory, sep: string): Converged {
  // Sink all manual (extra-layer) records to the end, keeping their relative order.
  const nonManual = history.filter(m => m.layer !== 'extra')
  const manual = history.filter(m => m.layer === 'extra')
  const ordered = manual.length ? [...nonManual, ...manual] : history

  let acc: string | null = null
  let deleted = false
  const seen: DisplayMod[] = []

  for (const m of ordered) {
    // Skip empty contributions (inherit ≡ no record). Keep 'none' even if value empty.
    if (m.op !== 'none' && (m.value === undefined || m.value === null || m.value === '')) continue
    seen.push({ ...m, superseded: false })
    if (m.op === 'none') {
      deleted = true
      acc = null
      continue
    }
    deleted = false
    if (m.op === 'append') {
      acc = acc ? `${acc}${sep}${m.value}` : m.value
    } else {
      acc = m.value
    }
  }

  // Mark each record superseded if a LATER record replaced (override/none) it.
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      if (seen[j].op === 'override' || seen[j].op === 'none') { seen[i].superseded = true; break }
    }
  }

  return { final: deleted ? null : acc, history: seen, deleted }
}

// =========================================================================
// buildHistories — the ONE recording pass. All queries (topology / relay
// closure / gateway / proxy) happen here; downstream only converge()s.
// =========================================================================

import type { SyncConfig, DefaultPeerConfig, ScriptType, WGDGlobalDefaults, MeshGroup, HybridMesh } from '~/types'
import type { GraphBase } from '~/composables/useGraphDerive'
import { TopologyModel } from '~/composables/useTopology'

const SCRIPT_TYPES: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

/**
 * Proxy (NAT) script for the PUBLIC node A. Generates the MASQUERADE iptables
 * rules for the proxied source IPs — appended to the node's PostUp/PostDown as
 * a single line (wg-quick parses PostUp as one value; newlines break it).
 *
 * Forwarding is already permitted by the node's DEFAULT scripts, and the default
 * MASQUERADE (`-s domain ! -d domain`) NATs domain→external while EXEMPTING
 * intra-domain traffic. That exemption is exactly why a proxied node X fails to
 * reach other in-domain peers (they see X's real source and can't route back).
 * So proxy adds ONLY one rule per proxied source IP: MASQUERADE X's packets
 * leaving the WG interface, covering the intra-domain case the default skips.
 */
export function buildProxyScript(proxiedIPs: string[]): { up: string; down: string } {
  const cmd = (ip: string) => (ip.includes(':') ? 'ip6tables' : 'iptables')
  // PostUp: add one MASQUERADE rule per proxied source IP (first bring-up by
  // wg-quick). Single line — wg-quick parses PostUp as one value, newlines break
  // it. ewctl (if used) does incremental -A/-D from the ExtraInfo block instead.
  const up = proxiedIPs.map(ip => `${cmd(ip)} -t nat -A POSTROUTING -s ${ip} -o %i -j MASQUERADE`)
  // PostDown: one-shot clear of every MASQUERADE rule on the %i interface (wg-quick
  // down runs this once). Lists POSTROUTING rules touching %i, flips -A→-D, deletes
  // each. Single line.
  const down = [
    `iptables -t nat -S POSTROUTING | grep -E -- '-o %i ' | grep -E -- '-j MASQUERADE' | sed 's/^-A/-D/' | xargs -r -L1 iptables -t nat`,
    `ip6tables -t nat -S POSTROUTING | grep -E -- '-o %i ' | grep -E -- '-j MASQUERADE' | sed 's/^-A/-D/' | xargs -r -L1 ip6tables -t nat`,
  ]
  return { up: up.join('; '), down: down.join('; ') }
}

/** Separator per field for converge() joining. */
export function sepOf(field: string): string {
  if (field === 'ALLOWED_IPS') return ', '
  if ((SCRIPT_TYPES as string[]).includes(field)) return '; '
  return ''
}

export interface RenderModel {
  /** peers[pubkey][field] = changelog (default → extra → declaration). */
  peers: Record<string, Record<string, FieldHistory>>
  /** conns[`${src}|${key}`][field] = changelog. key = target pubkey or 'CENTRAL_NODE'. */
  conns: Record<string, Record<string, FieldHistory>>
  /** `${src}->${target}` edges that are gateways (/24 whole-domain). */
  gatewayEdges: Set<string>
  /** pubkeys acting as a proxy PUBLIC (their PostUp carries the MASQUERADE block). */
  proxies: Set<string>
  /** pubkey → proxied source IPs (the -s CIDRs this node MASQUERADEs). Surfaced
   *  as a JSON comment block in the .conf so ewctl can diff without parsing scripts. */
  proxyLists: Record<string, string[]>
  /** connection keys that are gateway-declared & read-only, with no underlying conn. */
  connNoUnderlying: Set<string>
}

/**
 * The fully-merged final config — the OUTPUT of the render pipeline. Every field
 * is the converged (default → extra → declaration) final value, NOT a delta.
 * Consumers (config-generator, deriveGraphData) read these directly; they never
 * re-read raw .conf or fall back to defaults. This is a DISTINCT type from
 * SyncConfig.EXTRA_CONFIG (the manual-delta layer) — no shape overloading.
 */
export interface FinalConnConfig {
  allowedIPs: string[]
  endpoint?: string
  keepalive?: number | null
}
export interface FinalPeerConfig {
  // Identity (from the default layer / raw .conf — not converged fields).
  privateKey: string
  address: string[]
  // Converged peer-level values (viewer-independent; relay'd IPs in ownAllowedIPs).
  comments?: string
  endpoint?: string                       // peer's own endpoint (mesh-peer fallback base)
  dns?: string
  listenPort?: number | null
  ownAllowedIPs: string[]                 // own address + relay'd IPs (declaration append)
  scripts: Partial<Record<ScriptType, string>>   // incl. GLOBAL_SCRIPTS + proxy block
  proxyList: string[]                     // proxied source IPs (for ExtraInfo / ewctl)
  // This peer's view (as viewer) of each connection. key = target pubkey or 'CENTRAL_NODE'.
  conns: Record<string, FinalConnConfig>
}
export interface FinalConf {
  peers: Record<string, FinalPeerConfig>
  meshGroups: Record<string, MeshGroup>
  globalListenPort?: number | null
  globalDns: boolean
  globalScripts: Partial<Record<ScriptType, string>>
  hybridMesh?: HybridMesh
}

interface BuildCtx {
  globalListenPort?: number | null
  globalDns?: boolean
  globalScripts?: Partial<Record<ScriptType, string>>
  keepalive: string
}

function ownIPsOf(base: GraphBase, pubkey: string): string[] {
  const p = base.basePeers.find(b => b.publicKey === pubkey)
  return p?.default?.address ? [...p.default.address] : []
}

/** default-layer string per peer field (.conf + GLOBAL_*), mirrors PeerConfigModel.defaults. */
function peerDefaults(d: DefaultPeerConfig | undefined, onlineEndpoint: string | undefined, ctx: BuildCtx): Record<string, string | null> {
  const g = ctx
  const dns = !g.globalDns ? null : (d?.dns?.length ? d.dns.join(', ') : null)
  const listenPort = g.globalListenPort ? String(g.globalListenPort) : (d?.listenPort || null)
  const gsHasAny = !!g.globalScripts && Object.keys(g.globalScripts).length > 0
  const scriptOf = (t: ScriptType) => gsHasAny ? (g.globalScripts![t] || null) : (d?.scripts?.[t] || null)
  return {
    COMMENTS: null,
    ENDPOINT: onlineEndpoint || null,
    DNS: dns,
    LISTEN_PORT: listenPort,
    ALLOWED_IPS: d?.address?.length ? d.address.join(', ') : null,
    PreUp: scriptOf('PreUp'),
    PostUp: scriptOf('PostUp'),
    PreDown: scriptOf('PreDown'),
    PostDown: scriptOf('PostDown'),
  }
}

/** raw extra string per peer field (arrays joined, @ / none preserved). */
function peerExtras(c: any): Record<string, string | undefined> {
  return {
    COMMENTS: c?.COMMENTS,
    ENDPOINT: c?.ENDPOINT,
    DNS: c?.DNS,
    LISTEN_PORT: c?.LISTEN_PORT != null ? String(c.LISTEN_PORT) : undefined,
    ALLOWED_IPS: c?.ALLOWED_IPS ? c.ALLOWED_IPS.join(', ') : undefined,
    PreUp: c?.SCRIPTS?.PreUp,
    PostUp: c?.SCRIPTS?.PostUp,
    PreDown: c?.SCRIPTS?.PreDown,
    PostDown: c?.SCRIPTS?.PostDown,
  }
}

/** push the default-layer record (wgdashboard base). */
function pushDefault(hist: FieldHistory, defaultVal: string | null) {
  if (defaultVal) hist.push({ layer: 'default', op: 'override', value: defaultVal, origin: 'conf' })
}

/**
 * push the manual (extra) record — applied LAST, on top of default + all
 * declarations, so manual edits are the final say (@=append / none=delete /
 * value=override / empty=skip).
 */
function pushExtra(hist: FieldHistory, extraRaw: string | undefined) {
  if (extraRaw === undefined || extraRaw === null || extraRaw === '') return
  if (extraRaw === 'none') { hist.push({ layer: 'extra', op: 'none', value: '', origin: 'manual' }); return }
  if (extraRaw.startsWith('@')) {
    hist.push({ layer: 'extra', op: 'append', value: extraRaw.slice(1).trim(), origin: 'manual' })
  } else {
    hist.push({ layer: 'extra', op: 'override', value: extraRaw, origin: 'manual' })
  }
}

/**
 * Build per-field changelogs for every Peer and Connection in ONE pass.
 * Declaration contributions are computed directly from TopologyModel queries
 * (no with/without double-render).
 */
export function buildHistories(base: GraphBase, config: SyncConfig): RenderModel {
  const topo = new TopologyModel(base, config)
  const EXTRA = config.EXTRA_CONFIG || {}
  const ctx: BuildCtx = {
    globalListenPort: config.GLOBAL_LISTEN_PORT,
    globalDns: config.GLOBAL_DNS,
    globalScripts: config.GLOBAL_SCRIPTS,
    keepalive: base.globalDefaults?.peer_keep_alive || '21',
  }

  const model: RenderModel = {
    peers: {}, conns: {}, gatewayEdges: new Set(), proxies: new Set(), proxyLists: {}, connNoUnderlying: new Set(),
  }

  // --- declaration queries (once) ---
  const reach = topo.getRelayReachability()            // pubkey → reachable relayed nodes
  const gatewayDecls = topo.getGatewayDeclarations()   // {PUBLIC, PRIVATE} with underlying conn
  const { v4, v6 } = topo.getDomainNetworks()
  const domainIPs = [v4, v6].filter(Boolean) as string[]
  const centerOwnIPs = topo.getCenterOwnIPs()
  // Peers that explicitly roam via another exit — their implicit CENTER gateway
  // is disabled (X→CENTER stays CENTER's host IP, no domain-network stack).
  const gatewayPrivate = topo.getExplicitGatewayPrivates()

  // proxy: per PUBLIC node A, collect the source IPs of the privates it proxies
  // (manual PROXY + roaming nat, underlying-connection filtered). The MASQUERADE
  // is scoped to these source IPs, never the whole segment.
  const hm: any = config.HYBRID_MESH
  const proxySrcIPs = new Map<string, string[]>()   // A → proxied source IP CIDRs
  const addProxy = (pub: string, priv: string) => {
    model.proxies.add(pub)
    const arr = proxySrcIPs.get(pub) || []
    for (const ip of ownIPsOf(base, priv)) if (!arr.includes(ip)) arr.push(ip)
    proxySrcIPs.set(pub, arr)
    model.proxyLists[pub] = arr
  }
  for (const d of (hm?.DECLARATIONS?.PROXY || [])) {
    if (d.ENABLED !== false && topo.hasUnderlyingConnection(d.PUBLIC_PEER, d.PRIVATE_PEER)) addProxy(d.PUBLIC_PEER, d.PRIVATE_PEER)
  }
  for (const r of (hm?.ROAMING || [])) {
    if (r.ENABLED !== false && r.TYPE === 'nat' && topo.hasUnderlyingConnection(r.PUBLIC_PEER, r.PRIVATE_PEER)) addProxy(r.PUBLIC_PEER, r.PRIVATE_PEER)
  }

  const centerPub = base.centerPubKey

  // Gateway declarations WITHOUT an underlying connection (declared but cannot
  // render) — for the panel's "missing connection" error. Raw enabled pairs
  // minus those with an underlying connection.
  for (const d of (hm?.DECLARATIONS?.GATEWAY || [])) {
    if (d.ENABLED !== false && !topo.hasUnderlyingConnection(d.PUBLIC_PEER, d.PRIVATE_PEER)) {
      model.connNoUnderlying.add(`${d.PRIVATE_PEER}|${d.PUBLIC_PEER}`)
    }
  }
  for (const r of (hm?.ROAMING || [])) {
    if (r.ENABLED !== false && !topo.hasUnderlyingConnection(r.PUBLIC_PEER, r.PRIVATE_PEER)) {
      model.connNoUnderlying.add(`${r.PRIVATE_PEER}|${r.PUBLIC_PEER}`)
    }
  }

  for (const bp of base.basePeers) {
    const pk = bp.publicKey
    const d = bp.default
    const c = EXTRA[pk]
    const defs = peerDefaults(d, base.onlineEndpoints?.[pk], ctx)
    const exs = peerExtras(c)

    // ---- Peer global fields ---- order: default → declarations → manual(last)
    const pf: Record<string, FieldHistory> = {}
    const FIELDS = ['COMMENTS', 'ENDPOINT', 'DNS', 'LISTEN_PORT', 'ALLOWED_IPS', 'PreUp', 'PostUp', 'PreDown', 'PostDown']
    for (const f of FIELDS) {
      const h: FieldHistory = []
      pushDefault(h, defs[f])
      pf[f] = h
    }

    // declaration: relay-propagated IPs (this node relays others → owns their IPs)
    const reachable = reach.get(pk)
    if (reachable && reachable.size > 0) {
      const own = new Set(ownIPsOf(base, pk))
      const manual = new Set((c?.ALLOWED_IPS || []).filter((x: string) => x !== '@'))
      const added: string[] = []
      for (const target of reachable) {
        for (const ip of ownIPsOf(base, target)) {
          if (!own.has(ip) && !manual.has(ip) && !added.includes(ip)) added.push(ip)
        }
      }
      if (added.length) {
        pf.ALLOWED_IPS.push({ layer: 'declaration', op: 'append', value: added.join(', '), origin: 'relay' })
      }
    }

    // declaration: proxy scripts (this node is a proxy PUBLIC) — MASQUERADE
    // scoped to the proxied nodes' source IPs.
    if (model.proxies.has(pk)) {
      const { up, down } = buildProxyScript(proxySrcIPs.get(pk) || [])
      pf.PostUp.push({ layer: 'declaration', op: 'append', value: up, origin: 'proxy' })
      pf.PostDown.push({ layer: 'declaration', op: 'append', value: down, origin: 'proxy' })
    }

    for (const f of FIELDS) pushExtra(pf[f], exs[f])

    model.peers[pk] = pf

    // ---- Connection: X → CENTER ----
    // Model: default X→CENTER = CENTER's own /32+/128 (ordinary peer). A virtual
    // CENTER Gateway (implicit, enabled unless X explicitly roams via someone
    // else) stacks the domain network (/24+/80) on top → X treats CENTER as its
    // gateway. When X explicitly roams via A, the virtual CENTER Gateway is
    // disabled for X → no /24 stack → X→CENTER stays the ordinary /32+/128.
    // (The /24 domain network is the virtual-gateway declaration layer, sourced
    // from interfaceInfo.Address via getDomainNetworks — not a per-peer default.)
    if (centerPub) {
      const key = `${pk}|CENTRAL_NODE`
      const cP2p = c?.P2P_CONFIG?.['CENTRAL_NODE']
      const allowedHist: FieldHistory = []
      // default = CENTER's own host IPs (ordinary peer, not gateway)
      pushDefault(allowedHist, centerOwnIPs.length ? centerOwnIPs.join(', ') : null)
      // declaration: virtual CENTER Gateway stacks the domain network (/24+/80)
      // unless X explicitly roams via another exit (gatewayPrivate).
      if (!gatewayPrivate.has(pk) && domainIPs.length) {
        allowedHist.push({ layer: 'declaration', op: 'override', value: domainIPs.join(', '), origin: 'center-gateway' })
      }
      pushExtra(allowedHist, cP2p?.ALLOWED_IPS ? cP2p.ALLOWED_IPS.join(', ') : undefined)
      model.conns[key] = {
        ENDPOINT: histOf(topo.getCenterDialEndpoint(), cP2p?.ENDPOINT),
        ALLOWED_IPS: allowedHist,
        PERSISTENT_KEEPALIVE: histOf(ctx.keepalive, cP2p?.PERSISTENT_KEEPALIVE != null ? String(cP2p.PERSISTENT_KEEPALIVE) : undefined),
      }
    }
  }

  // ---- Connection: gateway edges X → A (whole-domain override) ----
  // The conn's ALLOWED_IPS history = A's own peer history (default + relay +
  // A's own manual — A's global declarations) + the gateway domain override +
  // X's manual P2P override. converge sinks both manuals to the end, so the
  // domain override wipes A's accumulated value, then A's manual + X's manual
  // append on top in order.
  for (const gw of gatewayDecls) {
    const key = `${gw.PRIVATE_PEER}|${gw.PUBLIC_PEER}`
    model.gatewayEdges.add(`${gw.PRIVATE_PEER}->${gw.PUBLIC_PEER}`)
    const aHist = model.peers[gw.PUBLIC_PEER]?.ALLOWED_IPS
    const allowedHist: FieldHistory = aHist ? aHist.map(m => ({ ...m })) : []
    if (domainIPs.length) allowedHist.push({ layer: 'declaration', op: 'override', value: domainIPs.join(', '), origin: `gateway:${gw.PUBLIC_PEER}` })
    const cP2p = EXTRA[gw.PRIVATE_PEER]?.P2P_CONFIG?.[gw.PUBLIC_PEER]
    pushExtra(allowedHist, cP2p?.ALLOWED_IPS ? cP2p.ALLOWED_IPS.join(', ') : undefined)
    model.conns[key] = {
      ENDPOINT: histOf(base.onlineEndpoints?.[gw.PUBLIC_PEER] || null, cP2p?.ENDPOINT),
      ALLOWED_IPS: allowedHist,
      PERSISTENT_KEEPALIVE: histOf(ctx.keepalive, cP2p?.PERSISTENT_KEEPALIVE != null ? String(cP2p.PERSISTENT_KEEPALIVE) : undefined),
    }
  }

  // ---- Connection: plain mesh edges with a manual P2P override (src → tgt) ----
  // Any EXTRA_CONFIG[src].P2P_CONFIG[tgt] not already modeled as CENTER/gateway
  // is a per-viewer override on a plain mesh edge. The conn's ALLOWED_IPS
  // history = tgt's own peer history (default + relay + tgt's own manual — tgt's
  // global declarations) + src's manual P2P override. converge sinks the manuals
  // to the end, so src's override appends on top of everything tgt declared.
  for (const [src, ec] of Object.entries(EXTRA)) {
    const p2pAll = (ec as any)?.P2P_CONFIG
    if (!p2pAll) continue
    for (const [tgt, p2p] of Object.entries(p2pAll as Record<string, any>)) {
      if (tgt === 'CENTRAL_NODE') continue
      const key = `${src}|${tgt}`
      if (model.conns[key]) continue   // already built (gateway)
      const tgtHist = model.peers[tgt]?.ALLOWED_IPS
      const allowedHist: FieldHistory = tgtHist ? tgtHist.map(m => ({ ...m })) : []
      pushExtra(allowedHist, p2p?.ALLOWED_IPS ? p2p.ALLOWED_IPS.join(', ') : undefined)
      model.conns[key] = {
        ENDPOINT: histOf(null, p2p?.ENDPOINT),
        ALLOWED_IPS: allowedHist,
        PERSISTENT_KEEPALIVE: histOf(null, p2p?.PERSISTENT_KEEPALIVE != null ? String(p2p.PERSISTENT_KEEPALIVE) : undefined),
      }
    }
  }

  return model
}

/** small helper: a 2-record history (default + manual) for scalar conn fields. */
function histOf(defaultVal: string | null, extraRaw: string | undefined): FieldHistory {
  const h: FieldHistory = []
  pushDefault(h, defaultVal)
  pushExtra(h, extraRaw)
  return h
}

// =========================================================================
// renderConfig — the ONE renderer for generation/graph. buildHistories +
// converge → a SyncConfig whose EXTRA_CONFIG holds the rendered values, in the
// shape config-generator + deriveGraphData consume. Replaces renderHybridMesh.
//
// Emits a field ONLY when something beyond the default contributed (a manual or
// declaration record) — reproducing the old "EXTRA_CONFIG = deltas on the raw
// .conf" semantics — EXCEPT X→CENTER ALLOWED_IPS, which is always materialized
// (matching the old renderer, so the GW marker / generation see /24 or /32).
// A converged null → 'none' (config-generator drops the key/line).
// =========================================================================

const SCRIPT_F: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

/**
 * Drop byte-identical duplicate CIDRs from a final AllowedIPs list, preserving
 * order + first occurrence. Containment (e.g. 192.168.222.0/24 + .0/32) is KEPT
 * — only an exactly-equal entry (.0/32 appearing twice) collapses. Applied to
 * the final merged output only; the live preview keeps every history record.
 */
function dedupExactCIDRs(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const c = raw.trim()
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

export function renderConfig(base: GraphBase, draft: SyncConfig, prebuilt?: RenderModel): FinalConf {
  const model = prebuilt || buildHistories(base, draft)
  const defaultOf = (pk: string) => base.basePeers.find(b => b.publicKey === pk)?.default

  // The merge: every field converged (default → extra → declaration) into its
  // final value. Output a distinct FinalConf — never the SyncConfig.EXTRA_CONFIG
  // shape — so consumers read finals directly, never re-reading raw sources.
  const peers: Record<string, FinalPeerConfig> = {}
  const peerOf = (pk: string): FinalPeerConfig => {
    if (!peers[pk]) {
      const d = defaultOf(pk)
      peers[pk] = {
        privateKey: d?.privateKey || '',
        address: d?.address || [],
        ownAllowedIPs: [],
        scripts: {},
        proxyList: model.proxyLists[pk] || [],
        conns: {},
      }
    }
    return peers[pk]
  }

  for (const [pk, pf] of Object.entries(model.peers)) {
    const fp = peerOf(pk)
    const scalar = (field: string): string | undefined => {
      const h = pf[field]; if (!h) return undefined
      const f = converge(h, sepOf(field)).final
      return f === null ? 'none' : f
    }
    fp.comments = scalar('COMMENTS')
    fp.endpoint = scalar('ENDPOINT')
    fp.dns = scalar('DNS')
    if (pf.LISTEN_PORT) {
      const f = converge(pf.LISTEN_PORT, sepOf('LISTEN_PORT')).final
      fp.listenPort = f ? Number(f) : null
    }
    if (pf.ALLOWED_IPS) {
      const f = converge(pf.ALLOWED_IPS, sepOf('ALLOWED_IPS')).final
      fp.ownAllowedIPs = f ? dedupExactCIDRs(f.split(', ')) : ['none']
    }
    for (const t of SCRIPT_F) {
      const h = pf[t]; if (!h) continue
      const f = converge(h, sepOf(t)).final
      fp.scripts[t] = f === null ? 'none' : f
    }
  }
  for (const [key, cf] of Object.entries(model.conns)) {
    const [src, p2pKey] = key.split('|')
    const conn: FinalConnConfig = { allowedIPs: [] }
    if (cf.ALLOWED_IPS) {
      const f = converge(cf.ALLOWED_IPS, sepOf('ALLOWED_IPS')).final
      conn.allowedIPs = f ? dedupExactCIDRs(f.split(', ')) : ['none']
    }
    if (cf.ENDPOINT) {
      const f = converge(cf.ENDPOINT, sepOf('ENDPOINT')).final
      conn.endpoint = f === null ? 'none' : f
    }
    if (cf.PERSISTENT_KEEPALIVE) {
      const f = converge(cf.PERSISTENT_KEEPALIVE, sepOf('PERSISTENT_KEEPALIVE')).final
      conn.keepalive = f ? Number(f) : null
    }
    peerOf(src).conns[p2pKey] = conn
  }

  return {
    peers,
    meshGroups: draft.MESH_GROUPS || {},
    globalListenPort: draft.GLOBAL_LISTEN_PORT,
    globalDns: draft.GLOBAL_DNS,
    globalScripts: draft.GLOBAL_SCRIPTS || {},
    hybridMesh: draft.HYBRID_MESH,
  }
}

// --- live editing: splice the form's extra value into a cached history ---

/** Build the extra-layer Mod from a raw form string (@=append / none / value). */
function extraMod(raw: string | undefined | null): Mod | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (raw === 'none') return { layer: 'extra', op: 'none', value: '', origin: 'manual' }
  if (raw.startsWith('@')) return { layer: 'extra', op: 'append', value: raw.slice(1).trim(), origin: 'manual' }
  return { layer: 'extra', op: 'override', value: raw, origin: 'manual' }
}

/**
 * Return a copy of `history` with its extra-layer (manual) records replaced by
 * `extra` appended at the END — manual is the final layer, on top of default +
 * declarations. Used for the live preview as the user types.
 */
function withFormExtra(history: FieldHistory, extra: Mod | null): FieldHistory {
  const out = history.filter(m => m.layer !== 'extra')
  if (extra) out.push(extra)
  return out
}

/** Converge a field for the live preview: cached history + form's extra value. */
export function convergeField(model: RenderModel, scope: 'peers' | 'conns', id: string, field: string, extraRaw: string | undefined): Converged {
  const base = (model[scope] as Record<string, Record<string, FieldHistory>>)[id]?.[field] || []
  const extra = extraMod(extraRaw)
  // peer scope: the history's own extra IS this form's manual — replace it.
  // conns scope: the history's extra is the OTHER peer's manual (copied from its
  // peer history); the form's manual is the viewer's own, NOT in the history —
  // append it and let converge sink both manuals to the end.
  const hist = scope === 'peers' ? withFormExtra(base, extra) : (extra ? [...base, extra] : base)
  return converge(hist, sepOf(field))
}

// =========================================================================
// Adapter: build the legacy ConnectionDeclaration shape from the RenderModel
// (zero re-render) for the EdgeEditPanel's gateway/readonly UI flags.
// =========================================================================

import type { ConnectionDeclaration } from '~/types'

/** Declaration-layer supplement for a connection (source→key edge), from the RenderModel. */
export function connDeclOf(model: RenderModel, source: string, target: string, key: string): ConnectionDeclaration {
  const empty: ConnectionDeclaration = {
    isGatewayDeclared: false, gatewayDomainIPs: [], relayIPs: [], readonly: false, noUnderlyingConnection: false,
  }
  const isGatewayDeclared = model.gatewayEdges.has(`${source}->${target}`)
  const noUnderlyingConnection = model.connNoUnderlying.has(`${source}|${target}`)

  if (isGatewayDeclared) {
    const hist = model.conns[`${source}|${target}`]?.ALLOWED_IPS || []
    const gw = hist.find(m => m.layer === 'declaration' && (m.origin || '').startsWith('gateway:'))
    const gatewayDomainIPs = gw ? gw.value.split(',').map(s => s.trim()).filter(Boolean) : []
    return { isGatewayDeclared: true, gatewayDomainIPs, relayIPs: [], readonly: true, noUnderlyingConnection }
  }

  // Virtual CENTER Gateway stacks the domain network on the X→CENTER edge when
  // X hasn't explicitly roamed via another exit (origin 'center-gateway').
  if (key === 'CENTRAL_NODE') {
    const hist = model.conns[`${source}|CENTRAL_NODE`]?.ALLOWED_IPS || []
    const cg = hist.find(m => m.layer === 'declaration' && m.origin === 'center-gateway')
    if (cg) {
      return { ...empty, centerGatewayIPs: cg.value.split(',').map(s => s.trim()).filter(Boolean) }
    }
  }
  return { ...empty, noUnderlyingConnection }
}


