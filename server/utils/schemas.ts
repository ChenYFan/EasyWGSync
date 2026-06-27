import { z } from 'zod'

export const PublicKeySchema = z.string().min(40).max(48)

export const IPCIDRSchema = z.string().min(3)

export const P2PConfigSchema = z.object({
  ENDPOINT: z.string().optional(),
  ALLOWED_IPS: z.array(IPCIDRSchema).optional(),
  PERSISTENT_KEEPALIVE: z.union([z.number(), z.string()]).optional(),
})

export const PeerExtraConfigSchema = z.object({
  COMMENTS: z.string().optional(),
  ENDPOINT: z.string().optional(),
  SCRIPTS: z.record(z.string()).optional(),
  DNS: z.string().optional(),
  LISTEN_PORT: z.number().optional(),
  ALLOWED_IPS: z.array(IPCIDRSchema).optional(),
  P2P_CONFIG: z.record(P2PConfigSchema).optional(),
})

// MeshGroup value: { PEERS, ENABLED }. ENABLED defaults to true.
export const MeshGroupSchema = z.object({
  PEERS: z.array(z.string()),
  ENABLED: z.boolean().default(true),
})

// Accept either the new {PEERS,ENABLED} shape or legacy string[] (auto-migrated).
export const MeshGroupValueSchema = z.union([
  MeshGroupSchema,
  z.array(z.string()).transform(arr => ({ PEERS: arr, ENABLED: true })),
])

export const SyncConfigSchema = z.object({
  GLOBAL_LISTEN_PORT: z.number().nullable().optional(),
  GLOBAL_DNS: z.boolean(),
  GLOBAL_SCRIPTS: z.record(z.string()),
  MESH_GROUPS: z.record(MeshGroupValueSchema),
  EXTRA_CONFIG: z.record(PeerExtraConfigSchema),
}).passthrough() // preserve HYBRID_MESH, RELAY_DECLARATIONS, GATEWAY_DECLARATIONS etc.

export const MeshGroupCreateSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  members: z.array(z.string()).default([]),
})

export const MeshGroupUpdateSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  members: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
})
