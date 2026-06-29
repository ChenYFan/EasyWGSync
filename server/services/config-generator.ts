import { configService } from './config-service'
import { fetchAllPeers, fetchRawConfig, fetchGlobalDefaults, fetchInterfaceInfo } from './wg-dashboard'
import { getShowEndpoints, derivePubKey } from './wireguard'
import { parsePeerConf, buildDefaultPeerConfig } from './wg-conf-parser'
import { getConfigMtime } from './storage'
import { createLogger } from '../utils/logger'
import { renderConfig, buildHistories } from '~/composables/useRenderModel'
import type { SyncConfig, ScriptType } from '~/types'
import type { GraphBase } from '~/composables/useGraphDerive'

const log = createLogger('ConfigGenerator')

const SCRIPT_TYPES: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

// Parse a raw .conf text (the CENTER wg0.conf) into per-peer [Peer] blocks,
// keyed by PublicKey. Used to source mesh peers' PublicKey + default fields.
function parseRawPeers(rawConf: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  let section: 'interface' | 'peer' | null = null
  let cur: Record<string, string> | null = null
  for (const raw of rawConf.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      if (cur && section === 'peer' && cur.PublicKey) out[cur.PublicKey] = cur
      section = sec[1].toLowerCase() === 'peer' ? 'peer' : 'interface'
      cur = section === 'peer' ? {} : null
      continue
    }
    if (section !== 'peer' || !cur) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim().replace(/\s+/g, '')
    const val = line.slice(eq + 1).trim()
    if (key && val) cur[key] = val
  }
  if (cur && section === 'peer' && cur.PublicKey) out[cur.PublicKey] = cur
  return out
}

export async function generatePeerConfig(peerName: string, overrideConfig?: SyncConfig): Promise<string> {
  const config = useRuntimeConfig()
  const rawConfig = overrideConfig || await configService.getAll()

  const [wgPeersResult, onlineResult, globalDefaultsResult, interfaceResult, rawResult] = await Promise.all([
    fetchAllPeers().catch(() => [] as Awaited<ReturnType<typeof fetchAllPeers>>),
    getShowEndpoints(config.wireguardConfigName).catch(() => ({} as Record<string, string>)),
    fetchGlobalDefaults().catch(() => ({})),
    fetchInterfaceInfo().catch(() => null),
    fetchRawConfig().catch(() => ''),
  ])

  const wgPeers = wgPeersResult
  const onlineEndpoints = onlineResult
  const globalDefaults = globalDefaultsResult

  let centerPubKey = interfaceResult?.PublicKey || ''
  if (!centerPubKey && rawResult) {
    const privKeyMatch = rawResult.match(/PrivateKey\s*=\s*(.+)/)
    if (privKeyMatch) {
      const derived = await derivePubKey(privKeyMatch[1].trim())
      if (derived) centerPubKey = derived
    }
  }

  const basePeers: GraphBase['basePeers'] = []
  for (const peer of wgPeers) {
    const parsed = parsePeerConf(peer.file || '')
    if (!parsed.privateKey) continue
    const pubKey = await derivePubKey(parsed.privateKey)
    if (!pubKey) continue
    basePeers.push({
      publicKey: pubKey,
      fileName: peer.fileName,
      isOnline: pubKey in onlineEndpoints,
      default: buildDefaultPeerConfig(parsed, globalDefaults, pubKey in onlineEndpoints, peer.fileName, pubKey),
    })
  }

  const base: GraphBase = {
    basePeers,
    centerPubKey,
    onlineEndpoints,
    interfaceInfo: interfaceResult,
    globalDefaults,
  }

  const model = buildHistories(base, rawConfig)
  const env = renderConfig(base, rawConfig, model)

  const peerData = wgPeers.find(p => p.fileName === peerName)
  if (!peerData?.file) return ''

  const parsedPeer = parsePeerConf(peerData.file)
  if (!parsedPeer.privateKey) return ''
  const priKey = parsedPeer.privateKey
  const pubKey = await derivePubKey(priKey)
  if (!pubKey) return ''

  const extra = env.EXTRA_CONFIG?.[pubKey] || {}
  const p2p = extra.P2P_CONFIG || {}

  // ===== 第一段: [Interface] + CENTER [Peer] =====
  // renderConfig already converged default + extra + declaration into final
  // values in `extra`. config-generator writes them directly — no fallback.
  const lines: string[] = ['[Interface]']

  // PrivateKey + Address: not modeled as field histories (raw .conf identity).
  lines.push(`PrivateKey = ${priKey}`)
  if (parsedPeer.address.length) lines.push(`Address = ${parsedPeer.address.join(', ')}`)

  // ListenPort (converged — includes GLOBAL_LISTEN_PORT override)
  if (extra.LISTEN_PORT != null) lines.push(`ListenPort = ${extra.LISTEN_PORT}`)

  // DNS (converged — GLOBAL_DNS false → 'none' sentinel → omit; else final value)
  if (extra.DNS && extra.DNS !== 'none') lines.push(`DNS = ${extra.DNS}`)

  // Scripts (converged — includes GLOBAL_SCRIPTS + proxy declaration + default)
  const scripts = extra.SCRIPTS || {}
  for (const t of SCRIPT_TYPES) {
    const content = scripts[t]
    if (content != null && content !== 'none' && content.trim() !== '') {
      lines.push(`${t} = ${content}`)
    }
  }

  // [Peer] — CENTER (from converged P2P_CONFIG.CENTRAL_NODE)
  if (centerPubKey && p2p.CENTRAL_NODE) {
    const central = p2p.CENTRAL_NODE
    lines.push('', '[Peer]')
    if (extra.COMMENTS && extra.COMMENTS !== 'none') lines.push(`#Comments = ${extra.COMMENTS}`)
    lines.push(`PublicKey = ${centerPubKey}`)
    if (central.ALLOWED_IPS && central.ALLOWED_IPS.length && !(central.ALLOWED_IPS.length === 1 && central.ALLOWED_IPS[0] === 'none')) {
      lines.push(`AllowedIPs = ${central.ALLOWED_IPS.join(', ')}`)
    }
    if (central.ENDPOINT && central.ENDPOINT !== 'none') {
      lines.push(`Endpoint = ${central.ENDPOINT}`)
    }
    if (central.PERSISTENT_KEEPALIVE != null && String(central.PERSISTENT_KEEPALIVE) !== 'none') {
      lines.push(`PersistentKeepalive = ${central.PERSISTENT_KEEPALIVE}`)
    }
  }

  // ===== 第二段: mesh [Peer] (fully generated by us) =====
  // Mesh peers' PublicKey + default AllowedIPs come from the CENTER wg0.conf
  // (rawPeers) — they're not in the converge model. Per-peer overrides come
  // from the converged P2P_CONFIG in `extra` (this peer's view of each peer).
  const rawPeers = rawResult ? parseRawPeers(rawResult) : {}
  const meshPeers = new Set<string>()
  for (const [name, group] of Object.entries(env.MESH_GROUPS || {})) {
    const members = Array.isArray(group) ? group : (group as any).PEERS
    const enabled = Array.isArray(group) ? true : (group as any).ENABLED !== false
    if (!enabled) continue
    if (members.includes(pubKey)) {
      for (const peerPubKey of members) {
        if (peerPubKey === pubKey || !rawPeers[peerPubKey]) continue
        meshPeers.add(peerPubKey)
      }
    }
  }

  for (const peerPubKey of meshPeers) {
    const rawPeer = rawPeers[peerPubKey]
    const peerP2p = extra.P2P_CONFIG?.[peerPubKey]   // this peer's converged view of that peer
    const peerExtra = env.EXTRA_CONFIG?.[peerPubKey] || {}

    lines.push('', '[Peer]')
    if (peerExtra.COMMENTS && peerExtra.COMMENTS !== 'none') lines.push(`#Comments = ${peerExtra.COMMENTS}`)
    lines.push(`PublicKey = ${peerPubKey}`)

    // AllowedIPs: converged P2P_CONFIG overrides; default = peer's own address from CENTER .conf
    const aip = peerP2p?.ALLOWED_IPS
    if (aip && aip.length && !(aip.length === 1 && aip[0] === 'none')) {
      lines.push(`AllowedIPs = ${aip.join(', ')}`)
    } else if (rawPeer.AllowedIPs) {
      lines.push(`AllowedIPs = ${rawPeer.AllowedIPs}`)
    }

    // Endpoint: converged P2P_CONFIG overrides; default = online endpoint
    const ep = peerP2p?.ENDPOINT
    if (ep && ep !== 'none') {
      lines.push(`Endpoint = ${ep}`)
    } else if (onlineEndpoints[peerPubKey]) {
      lines.push(`Endpoint = ${onlineEndpoints[peerPubKey]}`)
    } else if (rawPeer.Endpoint) {
      lines.push(`Endpoint = ${rawPeer.Endpoint}`)
    }

    // PersistentKeepalive: converged P2P_CONFIG or default 21
    const ka = peerP2p?.PERSISTENT_KEEPALIVE
    lines.push(`PersistentKeepalive = ${ka != null && String(ka) !== 'none' ? ka : 21}`)
  }

  // ===== ExtraInfo (proxy list + savedAt, for ewctl) =====
  const proxied = model.proxyLists[pubKey] || []
  const savedAt = await getConfigMtime()
  const extraInfo = JSON.stringify({ proxied, savedAt })
  lines.push('', `#===EASYWGSYNC_EXTRA_START===#`, `#${extraInfo}`, `#===EASYWGSYNC_EXTRA_END===#`)

  return lines.join('\n') + '\n'
}
