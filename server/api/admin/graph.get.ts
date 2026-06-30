// Returns read-only base data (peers/center/online from WGDashboard + wg CLI)
// plus the persisted config. Frontend derives the graph from a draft clone.

import { configService } from '~/server/services/config-service'
import { fetchAllPeers, fetchGlobalDefaults, fetchInterfaceInfo, fetchRawConfig } from '~/server/services/wg-dashboard'
import { getShowEndpoints, derivePubKey } from '~/server/services/wireguard'
import { parsePeerConf, buildDefaultPeerConfig } from '~/server/services/wg-conf-parser'
import type { WGDGlobalDefaults, WGDInterfaceInfo } from '~/types'
defineRouteMeta({ openAPI: {
    "summary": "获取图谱数据",
    "description": "返回编辑器所需的基础数据：节点列表、中心节点公钥、在线端点、全局默认值与已保存配置。需要管理员登录。",
    "tags": [
      "admin"
    ]
  } })
export default defineEventHandler(async () => {
  const runtimeConfig = useRuntimeConfig()
  const config = await configService.getAll()

  // Fetch WGDashboard data sources in parallel.
  const [wgPeersResult, onlineResult, globalDefaultsResult, interfaceResult, rawResult] = await Promise.all([
    fetchAllPeers().catch(() => [] as Awaited<ReturnType<typeof fetchAllPeers>>),
    getShowEndpoints(runtimeConfig.wireguardConfigName).catch(() => ({} as Record<string, string>)),
    fetchGlobalDefaults().catch(() => ({} as WGDGlobalDefaults)),
    fetchInterfaceInfo().catch(() => null),
    fetchRawConfig().catch(() => ''),
  ])

  const wgPeers = wgPeersResult
  const onlineEndpoints = onlineResult
  const globalDefaults = globalDefaultsResult
  const interfaceInfo: WGDInterfaceInfo | null = interfaceResult

  // CENTER public key: prefer interfaceInfo.PublicKey; fallback: derive from raw PrivateKey.
  let centerPubKey = interfaceInfo?.PublicKey || ''
  if (!centerPubKey && rawResult) {
    const privKeyMatch = rawResult.match(/PrivateKey\s*=\s*(.+)/)
    if (privKeyMatch) {
      const derived = await derivePubKey(privKeyMatch[1].trim())
      if (derived) centerPubKey = derived
    }
  }

  // Build DefaultPeerConfig layer from parsed .conf.
  const basePeers = []
  for (const peer of wgPeers) {
    const parsed = parsePeerConf(peer.file || '')
    if (!parsed.privateKey) continue
    const pubKey = await derivePubKey(parsed.privateKey)
    if (!pubKey) continue

    const defaultCfg = buildDefaultPeerConfig(
      parsed,
      globalDefaults,
      pubKey in onlineEndpoints,
      peer.fileName,
      pubKey,
    )
    basePeers.push({
      publicKey: pubKey,
      fileName: peer.fileName,
      isOnline: pubKey in onlineEndpoints,
      default: defaultCfg,
    })
  }

  return {
    basePeers,
    centerPubKey,
    onlineEndpoints,
    interfaceInfo,
    globalDefaults,
    config,
  }
})
