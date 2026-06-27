import { createLogger } from '../utils/logger'
import type { WGDashboardPeer } from '~/types'

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
