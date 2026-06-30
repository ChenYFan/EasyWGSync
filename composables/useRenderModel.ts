// Three-layer config convergence engine.
//
// Each field of every Peer/Connection is an ordered changelog (FieldHistory)
// with records from three layers applied in order:
//   default → declaration → manual (always last)
//
// buildHistories() is the single recording pass — all topology queries happen
// here. renderConfig() + converge() are pure folds over the changelogs.
// Downstream (config-generator, deriveGraphData, panels) reads converged finals.

export type Layer = 'default' | 'extra' | 'declaration'

// override = replace accumulated; append = add on top; none = delete key.
export type Op = 'override' | 'append' | 'none'

export interface Mod {
  layer: Layer
  op: Op
  value: string
  origin?: string
}

export type FieldHistory = Mod[]

export interface Converged {
  final: string | null
  history: DisplayMod[]
  deleted: boolean
}

/** A participating record annotated for display (struck if later replaced). */
export interface DisplayMod extends Mod {
  superseded: boolean
}

/**
 * Pure fold over a changelog. Manual (extra-layer) records are sunk to the end.
 * override → acc = value; append → acc + sep + value; none → mark deleted.
 */
export function converge(history: FieldHistory, sep: string): Converged {
  const nonManual = history.filter(m => m.layer !== 'extra')
  const manual = history.filter(m => m.layer === 'extra')
  const ordered = manual.length ? [...nonManual, ...manual] : history

  let acc: string | null = null
  let deleted = false
  const seen: DisplayMod[] = []

  for (const m of ordered) {
    if (m.op !== 'none' && (m.value === undefined || m.value === null || m.value === '')) continue
    seen.push({ ...m, superseded: false })
    if (m.op === 'none') { deleted = true; acc = null; continue }
    deleted = false
    if (m.op === 'append') { acc = acc ? `${acc}${sep}${m.value}` : m.value }
    else { acc = m.value }
  }

  // Mark each record superseded if a later record replaced it.
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      if (seen[j].op === 'override' || seen[j].op === 'none') { seen[i].superseded = true; break }
    }
  }

  return { final: deleted ? null : acc, history: seen, deleted }
}

// =========================================================================
// buildHistories — the single recording pass. All topology queries (relay
// closure, gateway, proxy) happen here; downstream only converge()s.
// =========================================================================

import type { SyncConfig, DefaultPeerConfig, ScriptType, WGDGlobalDefaults, MeshGroup, HybridMesh } from '~/types'
import type { GraphBase } from '~/composables/useGraphDerive'
import { TopologyModel } from '~/composables/useTopology'

const SCRIPT_TYPES: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

/**
 * Proxy (NAT) script: MASQUERADE iptables rules for proxied source IPs.
 * Appended to PUBLIC node's PostUp/PostDown. Exemption from the default
 * domain NAT is why proxy is needed for intra-domain traffic.
 */
export function buildProxyScript(proxiedIPs: string[]): { up: string; down: string } {
  const cmd = (ip: string) => (ip.includes(':') ? 'ip6tables' : 'iptables')
  const up = proxiedIPs.map(ip => `${cmd(ip)} -t nat -A POSTROUTING -s ${ip} -o %i -j MASQUERADE`)
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
  /** `${src}->${target}` edges that are gateways (whole-domain). */
  gatewayEdges: Set<string>
  /** pubkeys acting as proxy PUBLIC (PostUp carries MASQUERADE block). */
  proxies: Set<string>
  /** pubkey → proxied source CIDRs (for ExtraInfo / ewctl). */
  proxyLists: Record<string, string[]>
  /** connection keys that are gateway-declared with no underlying conn. */
  connNoUnderlying: Set<string>
}

/**
 * FinalConf — the fully-merged result. Consumers read these directly.
 * Distinct from SyncConfig.EXTRA_CONFIG (the manual-delta layer).
 */
export interface FinalConnConfig {
  allowedIPs: string[]
  endpoint?: string
  keepalive?: number | null
}
export interface FinalPeerConfig {
  privateKey: string
  address: string[]
  comments?: string
  endpoint?: string
  dns?: string
  listenPort?: number | null
  ownAllowedIPs: string[]
  scripts: Partial<Record<ScriptType, string>>
  proxyList: string[]
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

/** default-layer string per peer field (.conf + GLOBAL_*). */
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

/** push the manual (extra) record. Applied LAST. @=append / none=delete / value=override. */
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

  // Query topology once.
  const reach = topo.getRelayReachability()
  const gatewayDecls = topo.getGatewayDeclarations()
  const { v4, v6 } = topo.getDomainNetworks()
  const domainIPs = [v4, v6].filter(Boolean) as string[]
  const centerOwnIPs = topo.getCenterOwnIPs()
  const gatewayPrivate = topo.getExplicitGatewayPrivates()

  // Proxy: per PUBLIC node A, collect the source IPs of privates it proxies.
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

  // Gateway declarations without an underlying connection — for panel "missing connection" errors.
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

    // Peer global fields: default → declarations → manual(last)
    const pf: Record<string, FieldHistory> = {}
    const FIELDS = ['COMMENTS', 'ENDPOINT', 'DNS', 'LISTEN_PORT', 'ALLOWED_IPS', 'PreUp', 'PostUp', 'PreDown', 'PostDown']
    for (const f of FIELDS) {
      const h: FieldHistory = []
      pushDefault(h, defs[f])
      pf[f] = h
    }

    // relay-propagated IPs: this node relays others → owns their IPs
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

    // proxy scripts: this node is a proxy PUBLIC — MASQUERADE for proxied source IPs.
    if (model.proxies.has(pk)) {
      const { up, down } = buildProxyScript(proxySrcIPs.get(pk) || [])
      pf.PostUp.push({ layer: 'declaration', op: 'append', value: up, origin: 'proxy' })
      pf.PostDown.push({ layer: 'declaration', op: 'append', value: down, origin: 'proxy' })
    }

    for (const f of FIELDS) pushExtra(pf[f], exs[f])

    model.peers[pk] = pf

    // X → CENTER: default=CENTER's own /32+/128 (ordinary peer).
    // Virtual CENTER Gateway stacks domain network (/24+/80) unless X explicitly
    // roams via another exit → X→CENTER stays ordinary peer.
    if (centerPub) {
      const key = `${pk}|CENTRAL_NODE`
      const cP2p = c?.P2P_CONFIG?.['CENTRAL_NODE']
      const allowedHist: FieldHistory = []
      // default = CENTER's own host IPs
      pushDefault(allowedHist, centerOwnIPs.length ? centerOwnIPs.join(', ') : null)
      // virtual CENTER Gateway stacks domain network unless X explicitly roams
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

  // Gateway edges X → A: AllowedIPs = A's peer history + domain network override + X's P2P override.
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

  // Plain mesh edges with a manual P2P override (src → tgt).
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

/** Helper: 2-record history (default + manual) for scalar conn fields. */
function histOf(defaultVal: string | null, extraRaw: string | undefined): FieldHistory {
  const h: FieldHistory = []
  pushDefault(h, defaultVal)
  pushExtra(h, extraRaw)
  return h
}

// =========================================================================
// renderConfig — fold all changelogs → FinalConf.
// Emits a field only when something beyond the default contributed, EXCEPT
// X→CENTER ALLOWED_IPS which is always materialized so the GW marker sees it.
// A converged null → 'none' (config-generator drops the key/line).
// =========================================================================

const SCRIPT_F: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

/** Drop exact-duplicate CIDRs from the final AllowedIPs, preserving order. */
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

  // Fold all peer fields into FinalPeerConfig
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
// Adapter: build ConnectionDeclaration from the RenderModel (zero re-render).
// =========================================================================

import type { ConnectionDeclaration } from '~/types'

/** Declaration-layer supplement for a connection (source→key edge). */
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

  // Virtual CENTER Gateway stacks domain network on X→CENTER unless X roams elsewhere.
  if (key === 'CENTRAL_NODE') {
    const hist = model.conns[`${source}|CENTRAL_NODE`]?.ALLOWED_IPS || []
    const cg = hist.find(m => m.layer === 'declaration' && m.origin === 'center-gateway')
    if (cg) {
      return { ...empty, centerGatewayIPs: cg.value.split(',').map(s => s.trim()).filter(Boolean) }
    }
  }
  return { ...empty, noUnderlyingConnection }
}


