import { createLogger } from '../utils/logger'
import type { WGDashboardPeer, WGDGlobalDefaults, WGDInterfaceInfo } from '~/types'

const log = createLogger('WGDashboard')

function getConfig() {
  return useRuntimeConfig()
}

export async function fetchRawConfig(): Promise<string> {
  const config = getConfig()
  const url = `${config.wireguardDashboardUrl}/api/getWireguardConfigurationRawFile?configurationName=${config.wireguardConfigName}`

  const res = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      'wg-dashboard-apikey': config.wireguardDashboardApiKey,
    },
  })

  const json = await res.json()
  return json?.data?.content ?? ''
}

export async function fetchAllPeers(): Promise<WGDashboardPeer[]> {
  const config = getConfig()
  const url = `${config.wireguardDashboardUrl}/api/downloadAllPeers/${config.wireguardConfigName}`

  const res = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      'wg-dashboard-apikey': config.wireguardDashboardApiKey,
    },
  })

  const json = await res.json()
  return json?.data ?? []
}

export async function fetchPeerNames(): Promise<string[]> {
  const peers = await fetchAllPeers()
  return peers.map(p => p.fileName)
}

/**
 * Fetch WGDashboard's global default settings (`/api/getDashboardConfiguration`
 * → data.Peers): peer_endpoint_allowed_ip, peer_global_dns, peer_keep_alive,
 * peer_mtu, remote_endpoint. These are the placeholder/base values for the
 * DEFAULT config layer. Returns {} if unavailable.
 */
export async function fetchGlobalDefaults(): Promise<WGDGlobalDefaults> {
  const config = getConfig()
  const url = `${config.wireguardDashboardUrl}/api/getDashboardConfiguration`
  try {
    const res = await fetch(url, {
      headers: {
        'content-type': 'application/json',
        'wg-dashboard-apikey': config.wireguardDashboardApiKey,
      },
    })
    const json = await res.json()
    const peers = json?.data?.Peers
    return (peers && typeof peers === 'object') ? peers as WGDGlobalDefaults : {}
  } catch (e) {
    log.warn('getDashboardConfiguration unavailable', e)
    return {}
  }
}

/**
 * Fetch the CENTER/WG interface info (`/api/getWireguardConfigurations` → find
 * by configuration name): Name, Address, ListenPort, PrivateKey, PublicKey,
 * PreUp/PostUp/PreDown/PostDown, Status. Returns null if unavailable.
 */
export async function fetchInterfaceInfo(cfgName?: string): Promise<WGDInterfaceInfo | null> {
  const config = getConfig()
  const name = cfgName || config.wireguardConfigName
  const url = `${config.wireguardDashboardUrl}/api/getWireguardConfigurations`
  try {
    const res = await fetch(url, {
      headers: {
        'content-type': 'application/json',
        'wg-dashboard-apikey': config.wireguardDashboardApiKey,
      },
    })
    const json = await res.json()
    const list: any[] = json?.data || []
    return list.find((c: any) => c.Name === name) || null
  } catch (e) {
    log.warn('getWireguardConfigurations unavailable', e)
    return null
  }
}
