import { configService } from '~/server/services/config-service'
import { fetchAllPeers } from '~/server/services/wg-dashboard'
import { getShowEndpoints } from '~/server/services/wireguard'

defineRouteMeta({ openAPI: {
    "summary": "获取节点列表",
    "description": "列出全部节点公钥与地址及在线端点，并返回已保存的覆盖配置与 mesh 组。需要管理员登录。",
    "tags": ["admin"]
  } })
export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const syncConfig = await configService.getAll()

  let wgPeers: Awaited<ReturnType<typeof fetchAllPeers>> = []
  try {
    wgPeers = await fetchAllPeers()
  } catch { /* WGDashboard unavailable */ }

  let endpoints: Record<string, string> = {}
  try {
    endpoints = await getShowEndpoints(config.wireguardConfigName)
  } catch { /* wg not available */ }

  const peers = wgPeers.map(p => {
    const priKeyMatch = p.file?.match(/PrivateKey = (.+)/)
    const addressMatch = p.file?.match(/Address = (.+)/)
    return {
      fileName: p.fileName,
      publicKey: p.publicKey || null,
      address: addressMatch?.[1]?.trim() || null,
    }
  })

  return {
    peers,
    extraConfig: syncConfig.EXTRA_CONFIG,
    meshGroups: syncConfig.MESH_GROUPS,
    endpoints,
  }
})
