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

/** A converged AllowedIPs list with the ['none'] deleted-sentinel dropped. */
function realList(v: string[] | undefined): string[] {
  if (!v || (v.length === 1 && v[0] === 'none')) return []
  return v
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
  const finalConf = renderConfig(base, rawConfig, model)

  // Identify the target peer by fileName → publicKey (from basePeers, built once).
  const targetBase = basePeers.find(b => b.fileName === peerName)
  if (!targetBase) return ''
  const pubKey = targetBase.publicKey
  const me = finalConf.peers[pubKey]
  if (!me || !me.privateKey) return ''

  // [Interface]: serialize FinalPeerConfig — never re-parse raw .conf.
  // 'none' sentinel → omit.
  const lines: string[] = ['[Interface]']

  lines.push(`PrivateKey = ${me.privateKey}`)
  if (me.address.length) lines.push(`Address = ${me.address.join(', ')}`)
  if (me.listenPort != null) lines.push(`ListenPort = ${me.listenPort}`)
  if (me.dns && me.dns !== 'none') lines.push(`DNS = ${me.dns}`)
  for (const t of SCRIPT_TYPES) {
    const content = me.scripts[t]
    if (content != null && content !== 'none' && content.trim() !== '') {
      lines.push(`${t} = ${content}`)
    }
  }

  // [Peer] — CENTER (this peer's view of CENTRAL_NODE)
  const central = me.conns['CENTRAL_NODE']
  if (centerPubKey && central) {
    lines.push('', '[Peer]')
    if (me.comments && me.comments !== 'none') lines.push(`#Comments = ${me.comments}`)
    lines.push(`PublicKey = ${centerPubKey}`)
    const aip = realList(central.allowedIPs)
    if (aip.length) lines.push(`AllowedIPs = ${aip.join(', ')}`)
    if (central.endpoint && central.endpoint !== 'none') lines.push(`Endpoint = ${central.endpoint}`)
    if (central.keepalive != null) lines.push(`PersistentKeepalive = ${central.keepalive}`)
  }

  // [Peer] — mesh peers: viewer's P2P override → peer's ownAllowedIPs fallback.
  const meshPeers = new Set<string>()
  for (const [, group] of Object.entries(finalConf.meshGroups || {})) {
    const members = Array.isArray(group) ? group : (group as any).PEERS
    const enabled = Array.isArray(group) ? true : (group as any).ENABLED !== false
    if (!enabled) continue
    if (members.includes(pubKey)) {
      for (const peerPubKey of members) {
        if (peerPubKey === pubKey || !finalConf.peers[peerPubKey]) continue
        meshPeers.add(peerPubKey)
      }
    }
  }

  for (const peerPubKey of meshPeers) {
    const peer = finalConf.peers[peerPubKey]   // X's own converged values
    const view = me.conns[peerPubKey]          // this viewer's override of X

    lines.push('', '[Peer]')
    if (peer.comments && peer.comments !== 'none') lines.push(`#Comments = ${peer.comments}`)
    lines.push(`PublicKey = ${peerPubKey}`)

    const aip = realList(view?.allowedIPs).length ? realList(view?.allowedIPs) : realList(peer.ownAllowedIPs)
    if (aip.length) lines.push(`AllowedIPs = ${aip.join(', ')}`)

    const ep = (view?.endpoint && view.endpoint !== 'none') ? view.endpoint
      : (peer.endpoint && peer.endpoint !== 'none') ? peer.endpoint : null
    if (ep) lines.push(`Endpoint = ${ep}`)

    const ka = view?.keepalive
    lines.push(`PersistentKeepalive = ${ka != null ? ka : 21}`)
  }

  // ExtraInfo: proxy list + savedAt for ewctl version-skip.
  const proxied = me.proxyList || []
  const savedAt = await getConfigMtime()
  const extraInfo = JSON.stringify({ proxied, savedAt })
  lines.push('', `#===EASYWGSYNC_EXTRA_START===#`, `#${extraInfo}`, `#===EASYWGSYNC_EXTRA_END===#`)

  return lines.join('\n') + '\n'
}
