// Parse a WireGuard .conf text into a routing table for mock trace.
// Returns: { ownIPs: string[], peers: Map<pubkey, { allowedIPs: string[], endpoint?: string }> }

export interface ParsedPeer {
  allowedIPs: string[]
  endpoint?: string
  publicKey?: string
  comments?: string
}

export interface ParsedWireGuardConfig {
  ownIPs: string[]
  peers: Map<string, ParsedPeer> // keyed by PublicKey
}

export function parseWireGuardConfig(conf: string): ParsedWireGuardConfig {
  const ownIPs: string[] = []
  const peers = new Map<string, ParsedPeer>()

  const lines = conf.split('\n')
  let currentSection: string | null = null
  let currentPeer: ParsedPeer | null = null
  let currentPubKey: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // Section header
    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      // Save previous peer
      if (currentPeer && currentPubKey) {
        peers.set(currentPubKey, currentPeer)
      }
      currentSection = sectionMatch[1]
      currentPeer = null
      currentPubKey = null
      if (currentSection === 'Peer') {
        currentPeer = { allowedIPs: [] }
      }
      continue
    }

    // Key = Value
    const kvMatch = line.match(/^([A-Za-z_#]+)\s*=\s*(.+)$/)
    if (!kvMatch) continue
    const key = kvMatch[1].trim()
    const value = kvMatch[2].trim()

    if (currentSection === 'Interface') {
      if (key === 'Address') {
        ownIPs.push(...value.split(',').map(s => s.trim()))
      }
    } else if (currentSection === 'Peer' && currentPeer) {
      if (key === 'PublicKey') {
        currentPubKey = value
        currentPeer.publicKey = value
      } else if (key === 'AllowedIPs') {
        currentPeer.allowedIPs.push(...value.split(',').map(s => s.trim()))
      } else if (key === 'Endpoint') {
        currentPeer.endpoint = value
      } else if (key === '#Comments') {
        currentPeer.comments = value
      }
    }
  }

  // Save last peer
  if (currentPeer && currentPubKey) {
    peers.set(currentPubKey, currentPeer)
  }

  return { ownIPs, peers }
}

// IPv4 CIDR matching
export function ipv4InCIDR(ip: string, cidr: string): boolean {
  const target = parseIPv4(ip)
  const network = parseCIDR(cidr)
  if (!target || !network) return false
  const mask = network.prefix === 0 ? 0 : (~0 << (32 - network.prefix)) >>> 0
  return ((target >>> 0) & mask) === ((network.ip >>> 0) & mask)
}

function parseIPv4(ip: string): number | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number)
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

function parseCIDR(cidr: string): { ip: number; prefix: number } | null {
  const m = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/)
  if (!m) return null
  const ip = parseIPv4(m[1])
  if (ip === null) return null
  return { ip, prefix: parseInt(m[2]) }
}

export function getCIDRPrefix(cidr: string): number {
  const m = cidr.match(/\/(\d+)$/)
  return m ? parseInt(m[1]) : 32
}
