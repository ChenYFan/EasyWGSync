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
