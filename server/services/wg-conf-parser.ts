// server/services/wg-conf-parser.ts
//
// Single source of truth for parsing a WireGuard `.conf` text into a structured
// object. Shared by `graph.get.ts` (exposes JSON to the frontend) and
// `config-generator.ts` (builds the final .conf). "Backend parses .conf once."
//
// Pure: input text → output object, no side effects, no Nuxt runtime.

import type { ParsedPeerConf, DefaultPeerConfig, WGDGlobalDefaults, ScriptType } from '~/types'

const SCRIPT_TYPES: ScriptType[] = ['PreUp', 'PostUp', 'PreDown', 'PostDown']

/**
 * Parse a `.conf` text into a structured object.
 *
 * Handles `[Interface]` and `[Peer]` sections. Lines are `key = value`
 * (split on first ` = `). Comments (`#`, `;`) and blank lines are ignored.
 * `# 以下配置被EasyWGSync禁用 ...` prefixed lines (already-commented by the
 * generator) are skipped so re-parsing a generated config stays stable.
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

  // Section-aware parsing: track which section we are in.
  let section: 'interface' | 'peer' | null = null
  const lines = text.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('[')) {
      section = line.toLowerCase() === '[peer]' ? 'peer' : 'interface'
      continue
    }
    // Skip comment lines (incl. generator's "被禁用" markers).
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
 * Build the DEFAULT config layer (DefaultPeerConfig) from a parsed `.conf`,
 * global defaults, and identity. Shared by graph.get + config-generator so both
 * construct the default layer identically.
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
