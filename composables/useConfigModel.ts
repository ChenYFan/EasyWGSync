// Three-layer config model for Peer/Connection editing.
//
//   1. defaultConf : read-only base (node's .conf + global defaults)
//   2. extraConf   : the only editable layer (draft.EXTRA_CONFIG)
//   3. declarationConf : read-only, from HYBRID_MESH rendering
//
// String semantics:
//   - 'none'        → final = null (key deleted on generation)
//   - starts '@'    → keep default, then append the rest
//   - other value   → override default
//   - empty/absent  → inherit default

import type {
  DefaultPeerConfig,
  PeerExtraConfig,
  P2PConfig,
  ScriptType,
} from '~/types'

const SCRIPT_TYPES: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

export type FieldMode = 'override' | 'append'

export interface PeerForm {
  COMMENTS: string
  ENDPOINT: string
  DNS: string
  LISTEN_PORT: string
  ALLOWED_IPS: string[]
  ALLOWED_IPS_MODE: FieldMode
  SCRIPTS: Record<ScriptType, string>
  SCRIPTS_MODE: Record<ScriptType, FieldMode>
}

export interface ConnectionForm {
  ENDPOINT: string
  ALLOWED_IPS: string[]
  ALLOWED_IPS_MODE: FieldMode
  PERSISTENT_KEEPALIVE: string
}

// helpers: extra <-> form for multi-value fields
function arrToForm(stored: string[] | undefined): { mode: FieldMode; items: string[] } {
  if (!stored || stored.length === 0) return { mode: 'override', items: [] }
  if (stored[0] === '@') return { mode: 'append', items: stored.slice(1) }
  return { mode: 'override', items: [...stored] }
}

/** Build the stored extra array from form {mode, items}; undefined = absent. */
function formToArr(mode: FieldMode, items: string[]): string[] | undefined {
  const clean = items.map(s => s.trim()).filter(Boolean)
  if (mode === 'append') return ['@', ...clean]   // append keeps @ even if no items (= pure inherit)
  return clean.length > 0 ? clean : undefined
}

/** Split a stored script string into {mode, text}. */
function scriptToForm(stored: string | undefined): { mode: FieldMode; text: string } {
  if (stored === undefined) return { mode: 'override', text: '' }
  if (stored.startsWith('@')) return { mode: 'append', text: stored.slice(1).trim() }
  return { mode: 'override', text: stored }
}
function scriptFromForm(mode: FieldMode, text: string): string | undefined {
  const t = text.trim()
  if (mode === 'append') return t ? `@ ${t}` : '@'
  return t || undefined
}

export interface PeerModelCtx {
  /** node's own endpoint from wg (`onlineEndpoints[pubkey]`) — endpoint default. */
  onlineEndpoint?: string
  /** EasyWGSync GLOBAL_LISTEN_PORT (SyncConfig) — first-layer override of .conf ListenPort. */
  globalListenPort?: number | null
  /** EasyWGSync GLOBAL_DNS toggle — when false the .conf DNS line is dropped on gen. */
  globalDns?: boolean
  /** EasyWGSync GLOBAL_SCRIPTS — first-layer override of .conf scripts. */
  globalScripts?: Partial<Record<ScriptType, string>>
}

export class PeerConfigModel {
  constructor(
    private defaultLayer: DefaultPeerConfig | undefined,
    private confLayer: PeerExtraConfig | undefined,
    private ctx: PeerModelCtx = {},
  ) {}

  /**
   * default-layer string for each field (joined). The default layer = node's
   * `.conf` PLUS the EasyWGSync GLOBAL_* settings — both belong to the first
   * abstraction (see config-generator: GLOBAL_DNS/LISTEN_PORT/SCRIPTS are
   * applied before per-peer EXTRA_CONFIG).
   */
  private defaults(): Record<string, string | null> {
    const d = this.defaultLayer
    const g = this.ctx
    // DNS: GLOBAL_DNS falsy (false/undefined) drops the .conf DNS line entirely
    // — mirror config-generator's `if (!env.GLOBAL_DNS)`.
    const dns = !g.globalDns ? null : (d?.dns?.length ? d.dns.join(', ') : null)
    // ListenPort: GLOBAL_LISTEN_PORT (truthy) overrides the .conf ListenPort.
    const listenPort = g.globalListenPort ? String(g.globalListenPort) : (d?.listenPort || null)
    // Scripts: when GLOBAL_SCRIPTS has ANY key, the generator comments out ALL
    // four original .conf scripts and re-inserts only the GLOBAL_SCRIPTS ones —
    // so types absent from GLOBAL_SCRIPTS are dropped, not kept. When
    // GLOBAL_SCRIPTS is empty, the .conf scripts pass through.
    const gsHasAny = !!g.globalScripts && Object.keys(g.globalScripts).length > 0
    const scriptOf = (t: ScriptType) =>
      gsHasAny ? (g.globalScripts![t] || null) : (d?.scripts?.[t] || null)
    return {
      COMMENTS: null,
      ENDPOINT: this.ctx.onlineEndpoint || null,    // node's own endpoint (onlineEndpoints[pubkey])
      DNS: dns,
      LISTEN_PORT: listenPort,
      ALLOWED_IPS: d?.address?.length ? d.address.join(', ') : null,
      PreUp: scriptOf('PreUp'),
      PostUp: scriptOf('PostUp'),
      PreDown: scriptOf('PreDown'),
      PostDown: scriptOf('PostDown'),
    }
  }

  /** extraConf raw values for the editable form (NOT overlaid with default). */
  getExtraForm(): PeerForm {
    const c = this.confLayer
    const aip = arrToForm(c?.ALLOWED_IPS)
    const scripts: Record<ScriptType, string> = { PreUp: '', PostUp: '', PreDown: '', PostDown: '' }
    const scriptsMode: Record<ScriptType, FieldMode> = { PreUp: 'override', PostUp: 'override', PreDown: 'override', PostDown: 'override' }
    for (const t of SCRIPT_TYPES) {
      const s = scriptToForm(c?.SCRIPTS?.[t])
      scripts[t] = s.text
      scriptsMode[t] = s.mode
    }
    return {
      COMMENTS: c?.COMMENTS || '',
      ENDPOINT: c?.ENDPOINT || '',
      DNS: c?.DNS || '',
      LISTEN_PORT: c?.LISTEN_PORT != null ? String(c.LISTEN_PORT) : '',
      ALLOWED_IPS: aip.items,
      ALLOWED_IPS_MODE: aip.mode,
      SCRIPTS: scripts,
      SCRIPTS_MODE: scriptsMode,
    }
  }

  /** placeholders (default value shown in empty inputs). */
  getPlaceholders() {
    const defs = this.defaults()
    return {
      endpoint: defs.ENDPOINT || '自动发现',
      dns: defs.DNS || '系统默认',
      listenPort: defs.LISTEN_PORT || '',
      script: (t: ScriptType) => defs[t] || '无',
      allowedIp: (i: number) => this.defaultLayer?.address?.[i] || '节点自身 IP',
    }
  }

  /** Build PeerExtraConfig storing ONLY user-overridden fields (empty = absent). */
  toConfPatch(form: PeerForm): PeerExtraConfig {
    const data: PeerExtraConfig = {}
    if (form.COMMENTS.trim()) data.COMMENTS = form.COMMENTS.trim()
    if (form.ENDPOINT.trim()) data.ENDPOINT = form.ENDPOINT.trim()
    if (form.DNS.trim()) data.DNS = form.DNS.trim()
    if (form.LISTEN_PORT.trim()) data.LISTEN_PORT = Number(form.LISTEN_PORT)
    const aip = formToArr(form.ALLOWED_IPS_MODE, form.ALLOWED_IPS)
    if (aip) data.ALLOWED_IPS = aip
    const scripts: Partial<Record<ScriptType, string>> = {}
    for (const t of SCRIPT_TYPES) {
      const v = scriptFromForm(form.SCRIPTS_MODE[t], form.SCRIPTS[t])
      if (v !== undefined) scripts[t] = v
    }
    if (Object.keys(scripts).length > 0) data.SCRIPTS = scripts
    return data
  }
}

/** Default-layer values for a connection. Built by the panel from base. */
export interface DefaultConnection {
  endpoint: string            // peer→center: CENTER dial endpoint (remote_endpoint:ListenPort); mesh: target online endpoint
  allowedIPs: string[]        // peer→center: CENTER own host IPs (/32+/128); mesh: target address
  keepalive: string           // globalDefaults.peer_keep_alive ("21")
}

export class ConnectionConfigModel {
  constructor(
    private defaultLayer: DefaultConnection,
    private confLayer: P2PConfig | undefined,
  ) {}

  private defaults(): Record<string, string | null> {
    const d = this.defaultLayer
    return {
      ENDPOINT: d.endpoint || null,
      ALLOWED_IPS: d.allowedIPs?.length ? d.allowedIPs.join(', ') : null,
      PERSISTENT_KEEPALIVE: d.keepalive || null,
    }
  }

  getExtraForm(): ConnectionForm {
    const c = this.confLayer
    const aip = arrToForm(c?.ALLOWED_IPS)
    return {
      ENDPOINT: c?.ENDPOINT || '',
      ALLOWED_IPS: aip.items,
      ALLOWED_IPS_MODE: aip.mode,
      PERSISTENT_KEEPALIVE: c?.PERSISTENT_KEEPALIVE != null ? String(c.PERSISTENT_KEEPALIVE) : '',
    }
  }

  getPlaceholders() {
    const defs = this.defaults()
    return {
      endpoint: defs.ENDPOINT || '自动发现',
      allowedIp: (i: number) => this.defaultLayer.allowedIPs?.[i] || '',
      keepalive: defs.PERSISTENT_KEEPALIVE || '21',
    }
  }

  toConfPatch(form: ConnectionForm): P2PConfig {
    const data: P2PConfig = {}
    if (form.ENDPOINT.trim()) data.ENDPOINT = form.ENDPOINT.trim()
    const aip = formToArr(form.ALLOWED_IPS_MODE, form.ALLOWED_IPS)
    if (aip) data.ALLOWED_IPS = aip
    if (form.PERSISTENT_KEEPALIVE.trim()) data.PERSISTENT_KEEPALIVE = Number(form.PERSISTENT_KEEPALIVE)
    return data
  }
}
