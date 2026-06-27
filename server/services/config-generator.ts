import { configService } from './config-service'
import { fetchAllPeers, fetchRawConfig, fetchGlobalDefaults, fetchInterfaceInfo } from './wg-dashboard'
import { getShowEndpoints, derivePubKey } from './wireguard'
import { parsePeerConf, buildDefaultPeerConfig } from './wg-conf-parser'
import { createLogger } from '../utils/logger'
import { renderConfig, buildHistories } from '~/composables/useRenderModel'
import type { SyncConfig } from '~/types'
import type { GraphBase } from '~/composables/useGraphDerive'

const log = createLogger('ConfigGenerator')

export async function generatePeerConfig(peerName: string, overrideConfig?: SyncConfig): Promise<string> {
  const config = useRuntimeConfig()
  const rawConfig = overrideConfig || await configService.getAll()

  // Build base data for HYBRID_MESH rendering (need peer IP mapping).
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

  // Derive CENTER pubkey (prefer structured interface PublicKey).
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

  // Render the draft into concrete EXTRA_CONFIG values — ONE render path
  // (buildHistories + converge), shared with the frontend graph. Also keep the
  // model to surface the proxy list (JSON comment block for ewctl).
  const model = buildHistories(base, rawConfig)
  const env = renderConfig(base, rawConfig, model)

  const peerData = wgPeers.find(p => p.fileName === peerName)
  if (!peerData?.file) return ''

  let result = peerData.file

  const parsedPeer = parsePeerConf(peerData.file)
  if (!parsedPeer.privateKey) return ''
  const PriKey = parsedPeer.privateKey
  const PubKey = await derivePubKey(PriKey)
  if (!PubKey) return ''

  result = '# ===EasyWGSync托管，以下为原始配置=== #\n' + result

  // GLOBAL_DNS: comment out DNS if disabled
  if (!env.GLOBAL_DNS) {
    result = result.replace(/DNS \=/, '# DNS =')
  }

  // GLOBAL_LISTEN_PORT: override ListenPort
  if (env.GLOBAL_LISTEN_PORT) {
    result = result
      .replace(/^ListenPort \= .+/m, '')
      .replace(/\[Interface\]/, match => `[Interface]\nListenPort = ${env.GLOBAL_LISTEN_PORT}`)
  }

  // GLOBAL_SCRIPTS: comment originals, insert new ones before [Peer]
  if (env.GLOBAL_SCRIPTS && Object.keys(env.GLOBAL_SCRIPTS).length > 0) {
    result = result.replace(
      /^(PreUp|PostUp|PreDown|PostDown) \= .+/g,
      match => `# 以下配置被EasyWGSync(Global)禁用 ${match}`
    )
    for (const scriptType in env.GLOBAL_SCRIPTS) {
      const scriptContent = (env.GLOBAL_SCRIPTS as Record<string, string>)[scriptType]
      if (scriptContent && scriptContent.trim() !== '') {
        result = result.replace(/\[Peer\]/, match => `${scriptType} = ${scriptContent}\n${match}`)
      }
    }
  }

  // EXTRA_CONFIG for this peer
  if (env.EXTRA_CONFIG && PubKey in env.EXTRA_CONFIG) {
    const extraConfig = env.EXTRA_CONFIG[PubKey]

    if (extraConfig.COMMENTS && extraConfig.COMMENTS.trim() !== '') {
      result = result.replace(/\[Peer\]/, match => `# 本节点注释：${extraConfig.COMMENTS}\n${match}`)
    }

    // Per-peer scripts override
    if (extraConfig.SCRIPTS) {
      for (const scriptType in extraConfig.SCRIPTS) {
        let scriptContent = extraConfig.SCRIPTS[scriptType as keyof typeof extraConfig.SCRIPTS]
        if (scriptContent && scriptContent.trim() !== '') {
          if (scriptContent.indexOf('$GLOBAL') !== -1) {
            scriptContent = scriptContent.replace(
              /\$GLOBAL/g,
              (env.GLOBAL_SCRIPTS as Record<string, string>)[scriptType] || ''
            )
          }
          result = result.replace(
            new RegExp(`^(${scriptType}) \\= .+`, 'gm'),
            match => `# 以下配置被EasyWGSync(Peer)禁用 ${match}`
          )
          if (scriptContent !== 'none') {
            result = result.replace(/\[Peer\]/, match => `${scriptType} = ${scriptContent}\n${match}`)
          }
        }
      }
    }

    // Per-peer DNS（none = 显式删除该行，用系统默认）
    if (extraConfig.DNS) {
      result = result.replace(/^(DNS) \= .+/m, match => `# 以下配置被EasyWGSync(Peer)禁用 ${match}`)
      if (extraConfig.DNS !== 'none') {
        result = result.replace(/\[Interface\]/, match => `[Interface]\nDNS = ${extraConfig.DNS}`)
      }
    }

    // Per-peer ListenPort
    if (extraConfig.LISTEN_PORT) {
      result = result
        .replace(/^ListenPort \= .+/m, match => `# 以下配置被EasyWGSync(Peer)禁用 ${match}`)
        .replace(/\[Interface\]/, match => `[Interface]\nListenPort = ${extraConfig.LISTEN_PORT}`)
    }

    // CENTRAL_NODE P2P config
    if (extraConfig.P2P_CONFIG?.['CENTRAL_NODE']) {
      const centralNodeConfig = extraConfig.P2P_CONFIG['CENTRAL_NODE']
      if (centralNodeConfig.ALLOWED_IPS) {
        const aip = centralNodeConfig.ALLOWED_IPS
        if (aip.length === 1 && aip[0] === 'none') {
          // none = 删除 AllowedIPs 行
          result = result.replace(/^AllowedIPs \= .+/m, match => `# 以下配置被EasyWGSync(Peer)禁用 ${match}`)
        } else {
          result = result.replace(/AllowedIPs \= .+/, `AllowedIPs = ${aip.join(', ')}`)
        }
      }
      if (centralNodeConfig.ENDPOINT === 'none') {
        result = result.replace(/Endpoint \= .+/, match => `# 以下配置被EasyWGSync(Peer)禁用 ${match}`)
      } else if (centralNodeConfig.ENDPOINT) {
        result = result.replace(/Endpoint \= .+/, `Endpoint = ${centralNodeConfig.ENDPOINT}`)
      }
      if (centralNodeConfig.PERSISTENT_KEEPALIVE === 'none') {
        result = result.replace(/PersistentKeepalive \= .+/, match => `# 以下配置被EasyWGSync(Peer)禁用 ${match}`)
      } else if (centralNodeConfig.PERSISTENT_KEEPALIVE) {
        result = result.replace(/PersistentKeepalive \= .+/, `PersistentKeepalive = ${centralNodeConfig.PERSISTENT_KEEPALIVE}`)
      }
    }
  }

  // Section divider — emitted into the .conf output.
  result += '\n\n# ===以上为原始配置，接下来为P2P网络(MeshGroup)节点配置=== #\n'

  let RawWGConfigLines = rawResult.split('\n')
  const peerStartIdx = RawWGConfigLines.findIndex(line => line.startsWith('[Peer]'))
  if (peerStartIdx === -1) {
    return result + '\n# ===EasyWGSync托管，P2P配置结束=== #\n'
  }
  RawWGConfigLines = RawWGConfigLines.slice(peerStartIdx)

  const RawPeerConfigs: Record<string, Record<string, string>> = {}
  const PeerIndices: number[] = []
  RawWGConfigLines.forEach((line, index) => {
    if (line.startsWith('[Peer]')) PeerIndices.push(index)
  })
  PeerIndices.push(RawWGConfigLines.length)

  for (let i = 0; i < PeerIndices.length - 1; i++) {
    const peerConfigLines = RawWGConfigLines.slice(PeerIndices[i] + 1, PeerIndices[i + 1])
    const currentPeer: Record<string, string> = {}
    let currentPeerPubKey: string | null = null
    peerConfigLines.forEach(line => {
      const parts = line.split(' = ')
      if (parts.length < 2) return
      const key = parts[0].trim()
      const value = parts.slice(1).join(' = ').trim()
      if (!key || !value) return
      currentPeer[key] = value
      if (key === 'PublicKey') currentPeerPubKey = value
    })
    if (currentPeerPubKey) RawPeerConfigs[currentPeerPubKey] = currentPeer
  }

  // 1. Online endpoints
  const OnlineEndpoints = onlineEndpoints
  for (const OnlineEndpointPubKey in OnlineEndpoints) {
    if (RawPeerConfigs[OnlineEndpointPubKey]) {
      RawPeerConfigs[OnlineEndpointPubKey].Endpoint = OnlineEndpoints[OnlineEndpointPubKey]
    }
  }

  // 2.1 Apply EXTRA_CONFIG to all peers (skip self)
  for (const PeerPubKey in env.EXTRA_CONFIG) {
    if (PeerPubKey === PubKey) continue
    if (!RawPeerConfigs[PeerPubKey]) continue

    RawPeerConfigs[PeerPubKey]['#Comments'] = env.EXTRA_CONFIG[PeerPubKey]?.COMMENTS || ''

    if (env.EXTRA_CONFIG[PeerPubKey].ENDPOINT === 'none') {
      delete RawPeerConfigs[PeerPubKey].Endpoint
    } else if (env.EXTRA_CONFIG[PeerPubKey].ENDPOINT) {
      RawPeerConfigs[PeerPubKey].Endpoint = env.EXTRA_CONFIG[PeerPubKey].ENDPOINT!
    }

    // ALLOWED_IPS（['none'] = 删除该 key）
    const gAip = env.EXTRA_CONFIG[PeerPubKey].ALLOWED_IPS
    if (gAip) {
      if (gAip.length === 1 && gAip[0] === 'none') {
        delete RawPeerConfigs[PeerPubKey].AllowedIPs
      } else {
        RawPeerConfigs[PeerPubKey].AllowedIPs = gAip.join(', ')
      }
    }
  }

  // 2.1b Apply own P2P_CONFIG (this peer's view of other peers)
  if (PubKey in env.EXTRA_CONFIG && env.EXTRA_CONFIG[PubKey].P2P_CONFIG) {
    for (const PeerPubKey in env.EXTRA_CONFIG[PubKey].P2P_CONFIG) {
      if (PeerPubKey === PubKey || PeerPubKey === 'CENTRAL_NODE') continue
      if (!RawPeerConfigs[PeerPubKey]) continue

      const p2pConfig = env.EXTRA_CONFIG[PubKey].P2P_CONFIG![PeerPubKey]

      if (p2pConfig.ENDPOINT === 'none') {
        delete RawPeerConfigs[PeerPubKey].Endpoint
      } else if (p2pConfig.ENDPOINT) {
        RawPeerConfigs[PeerPubKey].Endpoint = p2pConfig.ENDPOINT
      }

      if (p2pConfig.ALLOWED_IPS) {
        const pAip = p2pConfig.ALLOWED_IPS
        if (pAip.length === 1 && pAip[0] === 'none') {
          delete RawPeerConfigs[PeerPubKey].AllowedIPs
        } else {
          RawPeerConfigs[PeerPubKey].AllowedIPs = pAip.join(', ')
        }
      }

      RawPeerConfigs[PeerPubKey].PersistentKeepalive = p2pConfig.PERSISTENT_KEEPALIVE
        ? String(p2pConfig.PERSISTENT_KEEPALIVE)
        : '21'
    }
  }

  // 2.2 Process MESH_GROUPS (skip disabled groups — keep members but no peer connections)
  const MeshPeers = new Set<string>()
  for (const meshGroupName in env.MESH_GROUPS) {
    const meshGroup = env.MESH_GROUPS[meshGroupName]
    // Support both new {PEERS,ENABLED} and legacy string[] shapes
    const members = Array.isArray(meshGroup) ? meshGroup : (meshGroup as any).PEERS
    const enabled = Array.isArray(meshGroup) ? true : (meshGroup as any).ENABLED !== false
    if (!enabled) continue
    if (members.includes(PubKey)) {
      members.forEach((peerPubKey: string) => {
        if (peerPubKey !== PubKey) {
          if (!RawPeerConfigs[peerPubKey]) return
          if (!RawPeerConfigs[peerPubKey]['#Groups']) RawPeerConfigs[peerPubKey]['#Groups'] = ''
          RawPeerConfigs[peerPubKey]['#Groups'] += meshGroupName + ' '
          MeshPeers.add(peerPubKey)
        }
      })
    }
  }

  // 2.3 Default PersistentKeepalive for mesh peers
  for (const peerPubKey of MeshPeers) {
    if (!RawPeerConfigs[peerPubKey]?.PersistentKeepalive) {
      RawPeerConfigs[peerPubKey].PersistentKeepalive = '21'
    }
  }

  // 3. Append mesh peer configs to result
  for (const peerPubKey of MeshPeers) {
    const peerConfig = RawPeerConfigs[peerPubKey]
    if (!peerConfig) continue
    result += `\n[Peer]\n`
    for (const key in peerConfig) {
      result += `${key} = ${peerConfig[key]}\n`
    }
  }

  result += '\n# ===EasyWGSync托管，P2P配置结束=== #\n'

  // Append a JSON comment block with this peer's proxy list (the source IPs it
  // MASQUERADEs). ewctl reads this to diff against live iptables and apply
  // incremental -A/-D without parsing PostUp scripts or tearing down the link.
  // wg-quick ignores '#' comment lines, so this never affects WireGuard itself.
  const proxied = model.proxyLists[PubKey] || []
  if (proxied.length) {
    const json = JSON.stringify({ proxied })
    result += `\n#===EASYWGSYNC_PROXY_START===#\n#${json}\n#===EASYWGSYNC_PROXY_END===#\n`
  }

  return result
}
