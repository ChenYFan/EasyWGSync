import { configService } from '~/server/services/config-service'
import { fetchAllPeers, fetchGlobalDefaults, fetchInterfaceInfo, fetchRawConfig } from '~/server/services/wg-dashboard'
import { getShowEndpoints, derivePubKey } from '~/server/services/wireguard'
import { parsePeerConf, buildDefaultPeerConfig } from '~/server/services/wg-conf-parser'
import type { WGDGlobalDefaults, WGDInterfaceInfo } from '~/types'

// Returns read-only base data (peers/center/online status from WGDashboard + wg CLI)
// plus the raw persisted config. The frontend derives the whole graph from a
// draft clone of `config`, so this endpoint does NOT compute nodes/edges anymore.
//
// Peers are exposed as structured JSON (DefaultPeerConfig) — the DEFAULT config
// layer — parsed once from their `.conf` text. Global defaults + CENTER
// interface info come from real JSON endpoints. Frontend never sees .conf text.
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

  // CENTER node's public key: prefer the structured PublicKey from interface info;
  // fall back to deriving from the raw config's PrivateKey.
  let centerPubKey = interfaceInfo?.PublicKey || ''
  if (!centerPubKey && rawResult) {
    const privKeyMatch = rawResult.match(/PrivateKey\s*=\s*(.+)/)
    if (privKeyMatch) {
      const derived = await derivePubKey(privKeyMatch[1].trim())
      if (derived) centerPubKey = derived
    }
  }

  // Read-only peer base info. Identity is the derived public key (from the
  // peer's own PrivateKey). The `default` field is the full DEFAULT config layer
  // (parsed .conf + global defaults).
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
