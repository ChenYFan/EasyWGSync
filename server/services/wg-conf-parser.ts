// Parse a WireGuard .conf into a structured object.
// Pure: input text → output object, no side effects, no Nuxt runtime.

import type { ParsedPeerConf, DefaultPeerConfig, WGDGlobalDefaults, ScriptType } from '~/types'

const SCRIPT_TYPES: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

/**
 * Parse .conf text → ParsedPeerConf. Handles [Interface] and [Peer] sections.
 */
export function parsePeerConf(text: string): ParsedPeerConf {
  const result: ParsedPeerConf = {
    privateKey: '',
    address: [],
    dns: [],
    listenPort: null,
    mtu: null,
    scripts: {},
    peerPersistentKeepalive: null,
    peerPublicKey: null,
  }

  if (!text) return result

  let section: 'interface' | 'peer' | null = null
  const lines = text.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('[')) {
      section = line.toLowerCase() === '[peer]' ? 'peer' : 'interface'
      continue
    }
    // Skip comment lines.
    if (line.startsWith('#') || line.startsWith(';')) continue

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim().replace(/\s+/g, '')
    if (!key) continue
    const value = line.slice(eqIdx + 1).trim()
    if (!value) continue

    const setScript = (k: string, v: string) => {
      const t = SCRIPT_TYPES.find(s => s.toLowerCase() === k.toLowerCase())
      if (t) result.scripts[t] = v
    }

    if (section === 'peer') {
      switch (key.toLowerCase()) {
        case 'persistentkeepalive':
          result.peerPersistentKeepalive = value
          break
        case 'publickey':
          result.peerPublicKey = value
          break
        default:
          break
      }
    } else {
      // [Interface] section (or before any header — treat as interface)
      switch (key.toLowerCase()) {
        case 'privatekey':
          result.privateKey = value
          break
        case 'address':
          result.address = value.split(',').map(s => s.trim()).filter(Boolean)
          break
        case 'dns':
          result.dns = value.split(',').map(s => s.trim()).filter(Boolean)
          break
        case 'listenport':
          result.listenPort = value
          break
        case 'mtu':
          result.mtu = value
          break
        case 'preup':
        case 'postup':
        case 'predown':
        case 'postdown':
          setScript(key, value)
          break
        default:
          break
      }
    }
  }

  return result
}

/**
 * Build the DEFAULT config layer from parsed .conf + global defaults + identity.
 */
export function buildDefaultPeerConfig(
  parsed: ParsedPeerConf,
  globalDefaults: WGDGlobalDefaults,
  isOnline: boolean,
  fileName: string,
  publicKey: string,
): DefaultPeerConfig {
  return {
    publicKey,
    privateKey: parsed.privateKey,
    fileName,
    isOnline,
    address: parsed.address,
    dns: parsed.dns,
    listenPort: parsed.listenPort,
    mtu: parsed.mtu,
    scripts: { ...parsed.scripts },
    persistentKeepalive: parsed.peerPersistentKeepalive,
    globalDefaults,
  }
}
