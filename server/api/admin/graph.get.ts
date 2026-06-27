import { configService } from '~/server/services/config-service'
import { fetchAllPeers, fetchRawConfig } from '~/server/services/wg-dashboard'
import { getShowEndpoints, derivePubKey } from '~/server/services/wireguard'

// Returns read-only base data (peers/center/online status from WGDashboard + wg CLI)
// plus the raw persisted config. The frontend derives the whole graph from a
// draft clone of `config`, so this endpoint does NOT compute nodes/edges anymore.
export default defineEventHandler(async () => {
  const runtimeConfig = useRuntimeConfig()
  const config = await configService.getAll()

  let wgPeers: Awaited<ReturnType<typeof fetchAllPeers>> = []
  try {
    wgPeers = await fetchAllPeers()
  } catch { /* WGDashboard unavailable */ }

  let onlineEndpoints: Record<string, string> = {}
  try {
    onlineEndpoints = await getShowEndpoints(runtimeConfig.wireguardConfigName)
  } catch { /* wg not available */ }

  // CENTER node's public key from server-side WG interface config
  let centerPubKey = ''
  try {
    const rawConfig = await fetchRawConfig()
    const privKeyMatch = rawConfig.match(/PrivateKey\s*=\s*(.+)/)
    if (privKeyMatch) {
      const derived = await derivePubKey(privKeyMatch[1].trim())
      if (derived) centerPubKey = derived
    }
  } catch { /* can't determine center */ }

  // Read-only peer base info (identity is the derived public key)
  const basePeers: Array<{ publicKey: string; fileName: string; address: string; isOnline: boolean }> = []
  for (const peer of wgPeers) {
    const priKeyMatch = peer.file?.match(/PrivateKey = (.+)/)
    const addressMatch = peer.file?.match(/Address = (.+)/)
    let pubKey = ''
    if (priKeyMatch) {
      const derived = await derivePubKey(priKeyMatch[1].trim())
      if (derived) pubKey = derived
    }
    if (!pubKey) continue
    basePeers.push({
      publicKey: pubKey,
      fileName: peer.fileName,
      address: addressMatch?.[1]?.trim() || '',
      isOnline: pubKey in onlineEndpoints,
    })
  }

  return {
    basePeers,
    centerPubKey,
    onlineEndpoints,
    config,
  }
})
