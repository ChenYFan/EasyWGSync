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
 * 'none' has lowest priority: it is resolved by the running fold like any other
 * record (a later override/append revives the key); only a SURVIVING delete at
 * the end yields final = null.
 */
export function converge(history: FieldHistory, sep: string): Converged {
  let acc: string | null = null
  let deleted = false
  const seen: DisplayMod[] = []

  for (const m of history) {
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

import type { SyncConfig, DefaultPeerConfig, ScriptType, WGDGlobalDefaults } from '~/types'
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
  for (const gw of gatewayDecls) {
    const key = `${gw.PRIVATE_PEER}|${gw.PUBLIC_PEER}`
    model.gatewayEdges.add(`${gw.PRIVATE_PEER}->${gw.PUBLIC_PEER}`)
    const aDefault = base.basePeers.find(b => b.publicKey === gw.PUBLIC_PEER)?.default
    const baseAllowed = aDefault?.address?.length ? aDefault.address.join(', ') : null
    const cP2p = EXTRA[gw.PRIVATE_PEER]?.P2P_CONFIG?.[gw.PUBLIC_PEER]
    const allowedHist: FieldHistory = []
    pushDefault(allowedHist, baseAllowed)
    if (domainIPs.length) allowedHist.push({ layer: 'declaration', op: 'override', value: domainIPs.join(', '), origin: `gateway:${gw.PUBLIC_PEER}` })
    pushExtra(allowedHist, cP2p?.ALLOWED_IPS ? cP2p.ALLOWED_IPS.join(', ') : undefined)
    model.conns[key] = {
      ENDPOINT: histOf(base.onlineEndpoints?.[gw.PUBLIC_PEER] || null, cP2p?.ENDPOINT),
      ALLOWED_IPS: allowedHist,
      PERSISTENT_KEEPALIVE: histOf(ctx.keepalive, cP2p?.PERSISTENT_KEEPALIVE != null ? String(cP2p.PERSISTENT_KEEPALIVE) : undefined),
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

export function renderConfig(base: GraphBase, draft: SyncConfig, prebuilt?: RenderModel): SyncConfig {
  const out: SyncConfig = JSON.parse(JSON.stringify(draft))
  out.EXTRA_CONFIG = out.EXTRA_CONFIG || {}
  const model = prebuilt || buildHistories(base, draft)

  // Emits the COMPLETE converged value for every modeled field — not just
  // deltas. config-generator writes these directly, no fallback to raw .conf.
  // `@`/empty = inherit accumulated lower layer; converge folds default → extra
  // → declaration into one final string. `none` = deleted (→ 'none' sentinel).
  for (const [pk, pf] of Object.entries(model.peers)) {
    const ec: any = (out.EXTRA_CONFIG[pk] = out.EXTRA_CONFIG[pk] || {})

    const scalar = (field: string, prop: string) => {
      const h = pf[field]; if (!h) return
      const f = converge(h, sepOf(field)).final
      ec[prop] = f === null ? 'none' : f
    }
    scalar('COMMENTS', 'COMMENTS')
    scalar('ENDPOINT', 'ENDPOINT')
    scalar('DNS', 'DNS')
    if (pf.LISTEN_PORT) {
      const f = converge(pf.LISTEN_PORT, sepOf('LISTEN_PORT')).final
      ec.LISTEN_PORT = f ? Number(f) : null
    }
    if (pf.ALLOWED_IPS) {
      const f = converge(pf.ALLOWED_IPS, sepOf('ALLOWED_IPS')).final
      ec.ALLOWED_IPS = f ? dedupExactCIDRs(f.split(', ')) : ['none']
    }
    for (const t of SCRIPT_F) {
      const h = pf[t]; if (!h) continue
      const f = converge(h, sepOf(t)).final
      ec.SCRIPTS = ec.SCRIPTS || {}
      ec.SCRIPTS[t] = f === null ? 'none' : f
    }
  }

  for (const [key, cf] of Object.entries(model.conns)) {
    const [src, p2pKey] = key.split('|')
    const ec: any = (out.EXTRA_CONFIG[src] = out.EXTRA_CONFIG[src] || {})
    ec.P2P_CONFIG = ec.P2P_CONFIG || {}
    const p2p: any = (ec.P2P_CONFIG[p2pKey] = ec.P2P_CONFIG[p2pKey] || {})
    if (cf.ALLOWED_IPS) {
      const f = converge(cf.ALLOWED_IPS, sepOf('ALLOWED_IPS')).final
      p2p.ALLOWED_IPS = f ? dedupExactCIDRs(f.split(', ')) : ['none']
    }
    if (cf.ENDPOINT) {
      const f = converge(cf.ENDPOINT, sepOf('ENDPOINT')).final
      p2p.ENDPOINT = f === null ? 'none' : f
    }
    if (cf.PERSISTENT_KEEPALIVE) {
      const f = converge(cf.PERSISTENT_KEEPALIVE, sepOf('PERSISTENT_KEEPALIVE')).final
      p2p.PERSISTENT_KEEPALIVE = f ? Number(f) : null
    }
  }

  return out
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
  return converge(withFormExtra(base, extraMod(extraRaw)), sepOf(field))
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


