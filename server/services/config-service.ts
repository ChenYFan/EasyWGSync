// Centralized config service: reads/writes against data/config.json.
// Business logic (conflict checks, read-modify-write, response shaping) lives here.
// Validation (zod) stays in route handlers.

import { readSyncConfig, updateSyncConfig } from './storage'
import type { SyncConfig, PeerExtraConfig, P2PConfig } from '~/types'

type GlobalConfig = Pick<SyncConfig, 'GLOBAL_LISTEN_PORT' | 'GLOBAL_DNS' | 'GLOBAL_SCRIPTS'>

export const configService = {
  async getAll(): Promise<SyncConfig> {
    return readSyncConfig()
  },

  // Overwrite the entire config (draft commit). Validated by SyncConfigSchema
  // inside writeSyncConfig.
  async replaceAll(config: SyncConfig): Promise<SyncConfig> {
    return updateSyncConfig(() => config)
  },

  async getGlobal(): Promise<GlobalConfig> {
    const c = await readSyncConfig()
    return {
      GLOBAL_LISTEN_PORT: c.GLOBAL_LISTEN_PORT,
      GLOBAL_DNS: c.GLOBAL_DNS,
      GLOBAL_SCRIPTS: c.GLOBAL_SCRIPTS,
    }
  },

  async updateGlobal(patch: Partial<GlobalConfig>): Promise<GlobalConfig> {
    const updated = await updateSyncConfig(c => ({
      ...c,
      ...(patch.GLOBAL_LISTEN_PORT !== undefined && { GLOBAL_LISTEN_PORT: patch.GLOBAL_LISTEN_PORT }),
      ...(patch.GLOBAL_DNS !== undefined && { GLOBAL_DNS: patch.GLOBAL_DNS }),
      ...(patch.GLOBAL_SCRIPTS !== undefined && { GLOBAL_SCRIPTS: patch.GLOBAL_SCRIPTS }),
    }))
    return {
      GLOBAL_LISTEN_PORT: updated.GLOBAL_LISTEN_PORT,
      GLOBAL_DNS: updated.GLOBAL_DNS,
      GLOBAL_SCRIPTS: updated.GLOBAL_SCRIPTS,
    }
  },

  async getPeer(pubkey: string): Promise<PeerExtraConfig> {
    const c = await readSyncConfig()
    return c.EXTRA_CONFIG[pubkey] || {}
  },

  async upsertPeer(pubkey: string, data: PeerExtraConfig): Promise<PeerExtraConfig> {
    const updated = await updateSyncConfig(c => ({
      ...c,
      EXTRA_CONFIG: { ...c.EXTRA_CONFIG, [pubkey]: data },
    }))
    return updated.EXTRA_CONFIG[pubkey]
  },

  async deletePeer(pubkey: string): Promise<void> {
    await updateSyncConfig(c => {
      const { [pubkey]: _, ...rest } = c.EXTRA_CONFIG
      return { ...c, EXTRA_CONFIG: rest }
    })
  },

  async listGroups(): Promise<Record<string, { PEERS: string[]; ENABLED: boolean }>> {
    const c = await readSyncConfig()
    const out: Record<string, { PEERS: string[]; ENABLED: boolean }> = {}
    for (const [name, g] of Object.entries(c.MESH_GROUPS)) {
      // Normalize legacy string[] shape
      const members = Array.isArray(g) ? g : (g as any).PEERS
      const enabled = Array.isArray(g) ? true : (g as any).ENABLED !== false
      out[name] = { PEERS: members, ENABLED: enabled }
    }
    return out
  },

  async createGroup(name: string, members: string[]): Promise<{ name: string; members: string[] }> {
    const updated = await updateSyncConfig(c => {
      if (name in c.MESH_GROUPS) {
        throw createError({ statusCode: 409, data: { error: `Group "${name}" already exists` } })
      }
      return { ...c, MESH_GROUPS: { ...c.MESH_GROUPS, [name]: { PEERS: members, ENABLED: true } } }
    })
    return { name, members: (updated.MESH_GROUPS[name] as any).PEERS }
  },

  async updateGroup(
    currentName: string,
    opts: { name?: string; members?: string[]; enabled?: boolean }
  ): Promise<{ name: string; members: string[]; enabled: boolean }> {
    const { name: newName, members, enabled } = opts
    const updated = await updateSyncConfig(c => {
      if (!(currentName in c.MESH_GROUPS)) {
        throw createError({ statusCode: 404, data: { error: `Group "${currentName}" not found` } })
      }
      const groups = { ...c.MESH_GROUPS }
      const cur = groups[currentName] as any
      const curMembers = Array.isArray(cur) ? cur : cur.PEERS
      const curEnabled = Array.isArray(cur) ? true : cur.ENABLED !== false

      if (newName && newName !== currentName) {
        if (newName in groups) {
          throw createError({ statusCode: 409, data: { error: `Group "${newName}" already exists` } })
        }
        groups[newName] = {
          PEERS: members ?? curMembers,
          ENABLED: enabled ?? curEnabled,
        }
        delete groups[currentName]
      } else {
        groups[currentName] = {
          PEERS: members ?? curMembers,
          ENABLED: enabled ?? curEnabled,
        }
      }
      return { ...c, MESH_GROUPS: groups }
    })
    const finalName = newName || currentName
    const g = updated.MESH_GROUPS[finalName] as any
    return { name: finalName, members: g.PEERS, enabled: g.ENABLED }
  },

  async deleteGroup(name: string): Promise<void> {
    await updateSyncConfig(c => {
      if (!(name in c.MESH_GROUPS)) {
        throw createError({ statusCode: 404, data: { error: `Group "${name}" not found` } })
      }
      const { [name]: _, ...rest } = c.MESH_GROUPS
      return { ...c, MESH_GROUPS: rest }
    })
  },

  // === P2P_CONFIG (directional edge config) ===
  async upsertP2P(source: string, target: string, data: P2PConfig): Promise<P2PConfig> {
    const updated = await updateSyncConfig(c => {
      const extra = { ...c.EXTRA_CONFIG }
      const src = { ...(extra[source] || {}) }
      src.P2P_CONFIG = { ...(src.P2P_CONFIG || {}), [target]: data }
      extra[source] = src
      return { ...c, EXTRA_CONFIG: extra }
    })
    return updated.EXTRA_CONFIG[source]?.P2P_CONFIG?.[target] ?? {}
  },

  async deleteP2P(source: string, target: string): Promise<void> {
    await updateSyncConfig(c => {
      const extra = { ...c.EXTRA_CONFIG }
      if (extra[source]?.P2P_CONFIG?.[target]) {
        const { [target]: _, ...restP2P } = extra[source].P2P_CONFIG!
        extra[source] = { ...extra[source], P2P_CONFIG: restP2P }
      }
      return { ...c, EXTRA_CONFIG: extra }
    })
  },
}
