export type ScriptType = 'PreUp' | 'PostUp' | 'PreDown' | 'PostDown'

export interface P2PConfig {
  ENDPOINT?: string
  ALLOWED_IPS?: string[]
  PERSISTENT_KEEPALIVE?: number | string
}

export interface PeerExtraConfig {
  COMMENTS?: string
  ENDPOINT?: string
  SCRIPTS?: Partial<Record<ScriptType, string>>
  DNS?: string
  LISTEN_PORT?: number
  ALLOWED_IPS?: string[]
  P2P_CONFIG?: Record<string, P2PConfig>
}

export interface MeshGroup {
  PEERS: string[]
  ENABLED: boolean
}

export interface Declaration {
  PUBLIC_PEER: string
  PRIVATE_PEER: string
  ENABLED: boolean
}

export interface RoamingEntry extends Declaration {
  TYPE: 'flatten' | 'nat'
}

export interface HybridMesh {
  DECLARATIONS?: {
    RELAY?: Declaration[]
    PROXY?: Declaration[]
    GATEWAY?: Declaration[]
  }
  ROAMING?: RoamingEntry[]
}

export interface SyncConfig {
  GLOBAL_LISTEN_PORT?: number | null
  GLOBAL_DNS: boolean
  GLOBAL_SCRIPTS: Partial<Record<ScriptType, string>>
  MESH_GROUPS: Record<string, MeshGroup>
  EXTRA_CONFIG: Record<string, PeerExtraConfig>
  HYBRID_MESH?: HybridMesh
}

export interface WGDashboardPeer {
  fileName: string
  file: string
  publicKey?: string
}

// === Three-layer config model types ===

/** Global default values from WGDashboard (`/api/getDashboardConfiguration` → data.Peers). */
export interface WGDGlobalDefaults {
  peer_display_mode?: string
  peer_endpoint_allowed_ip?: string   // "0.0.0.0/0"
  peer_global_dns?: string            // "1.1.1.1"
  peer_keep_alive?: string            // "21"
  peer_mtu?: string                   // "1420"
  remote_endpoint?: string            // center's public address
}

/** CENTER/WG interface info from `/api/getWireguardConfigurations`. */
export interface WGDInterfaceInfo {
  Name: string
  Address?: string
  ListenPort?: string
  PrivateKey?: string
  PublicKey?: string
  PreUp?: string
  PostUp?: string
  PreDown?: string
  PostDown?: string
  Status?: string
}

/** Structured parse of a peer's `.conf` text. Source of the default layer. */
export interface ParsedPeerConf {
  privateKey: string
  address: string[]                       // Address split on ','
  dns: string[]                           // DNS = ...
  listenPort: string | null
  mtu: string | null
  scripts: Partial<Record<ScriptType, string>>
  // [Peer] section fields (kept for parsing completeness; CENTER semantics
  // come from interfaceInfo/globalDefaults via TopologyModel, NOT from these —
  // a peer .conf has multiple [Peer] blocks and only the last survives here).
  peerPersistentKeepalive: string | null
  peerPublicKey: string | null
}

/**
 * The DEFAULT config layer for a peer: parsed `.conf` + global defaults.
 * Read-only, sourced from WGDashboard. This is the placeholder/base layer.
 */
export interface DefaultPeerConfig {
  publicKey: string
  privateKey: string                      // node's own .conf [Interface] PrivateKey (admin-only)
  fileName: string
  isOnline: boolean
  // From parsed .conf [Interface]
  address: string[]
  dns: string[]                           // node's OWN .conf DNS
  listenPort: string | null
  mtu: string | null
  scripts: Partial<Record<ScriptType, string>>
  // From parsed .conf [Peer] (keepalive). CENTER's AllowedIPs/endpoint are NOT
  // here — they come from interfaceInfo/globalDefaults (TopologyModel), since a
  // peer .conf has multiple [Peer] blocks and "the CENTER one" can't be reliably
  // identified from the parsed last-[Peer] values.
  persistentKeepalive: string | null
  // Global defaults (shared across peers)
  globalDefaults: WGDGlobalDefaults
}

// === Declaration layer (read-only supplement from HYBRID_MESH rendering) ===

/** Declaration-layer supplement for a peer (read-only). */
export interface PeerDeclaration {
  /** Relay-transitively-propagated ALLOWED_IPs beyond what conf already owns. */
  relayIPs: string[]
  /** Proxy MASQUERADE script blocks (PostUp/PostDown) produced by PROXY/Roaming-NAT. */
  proxyScripts: Partial<Record<ScriptType, string>>
  /** Gateway-degraded CENTER segment applied to this peer's CENTRAL_NODE (if any). */
  degradedCenterIPs?: string[]
  /** Whether any declaration affects this peer. */
  active: boolean
}

/** Declaration-layer supplement for a connection/edge (read-only). */
export interface ConnectionDeclaration {
  /** This edge is produced by an enabled GATEWAY (or Roaming) declaration. */
  isGatewayDeclared: boolean
  /** Whole-domain IPs (/24 + /80) the gateway edge forces. */
  gatewayDomainIPs: string[]
  /** Relay-propagated IPs supplementing this edge beyond conf. */
  relayIPs: string[]
  /** Domain IPs the virtual CENTER Gateway stacks on the X→CENTER edge (when X
   *  hasn't explicitly roamed via another exit). Empty when the virtual gateway
   *  is disabled for X (X→CENTER stays the ordinary /32+/128). */
  centerGatewayIPs?: string[]
  /** True when the edge should be fully read-only (gateway-declared). */
  readonly: boolean
  /** GATEWAY/ROAMING declaration exists but no underlying direct connection. */
  noUnderlyingConnection: boolean
}
