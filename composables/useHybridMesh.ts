// composables/useHybridMesh.ts
//
// HYBRID_MESH intent-manipulation helpers (add/remove RELAY/PROXY/GATEWAY and
// ROAMING declarations on the draft). Rendering moved to useRenderModel
// (buildHistories + converge → renderConfig); this file is now intent-only.

import type { SyncConfig, HybridMesh, RoamingEntry } from '~/types'

/** Deep-clone via JSON round-trip. Safe for SyncConfig shapes (no Dates, etc.). */
function cloneConfig(cfg: SyncConfig): SyncConfig {
  return JSON.parse(JSON.stringify(cfg))
}

function emptyHybridMesh(): HybridMesh {
  return { DECLARATIONS: { RELAY: [], PROXY: [], GATEWAY: [] }, ROAMING: [] }
}

export function addDeclaration(
  hm: HybridMesh | undefined,
  kind: 'RELAY' | 'PROXY' | 'GATEWAY',
  pub: string,
  priv: string,
  enabled = true
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm, DECLARATIONS: { ...hm.DECLARATIONS }, ROAMING: [...(hm.ROAMING || [])] } as any) as HybridMesh : emptyHybridMesh()
  if (!out.DECLARATIONS) out.DECLARATIONS = { RELAY: [], PROXY: [], GATEWAY: [] }
  if (!out.DECLARATIONS[kind]) out.DECLARATIONS[kind] = []
  const list = out.DECLARATIONS[kind]!
  if (!list.some(d => d.PUBLIC_PEER === pub && d.PRIVATE_PEER === priv)) {
    list.push({ PUBLIC_PEER: pub, PRIVATE_PEER: priv, ENABLED: enabled })
  }
  return out
}

export function removeDeclaration(
  hm: HybridMesh | undefined,
  kind: 'RELAY' | 'PROXY' | 'GATEWAY',
  pub: string,
  priv: string
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm } as any) as HybridMesh : emptyHybridMesh()
  if (out.DECLARATIONS?.[kind]) {
    out.DECLARATIONS[kind] = out.DECLARATIONS[kind]!.filter(
      d => !(d.PUBLIC_PEER === pub && d.PRIVATE_PEER === priv)
    )
  }
  return out
}

// In-place edit: replace the entry matching (origPub, origPriv) with the new
// values, KEEPING its position in the list (remove+add would reorder it to the
// bottom). Falls back to append if the original isn't found.
export function updateDeclaration(
  hm: HybridMesh | undefined,
  kind: 'RELAY' | 'PROXY' | 'GATEWAY',
  origPub: string,
  origPriv: string,
  pub: string,
  priv: string,
  enabled = true
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm } as any) as HybridMesh : emptyHybridMesh()
  if (!out.DECLARATIONS) out.DECLARATIONS = { RELAY: [], PROXY: [], GATEWAY: [] }
  if (!out.DECLARATIONS[kind]) out.DECLARATIONS[kind] = []
  const list = out.DECLARATIONS[kind]!
  const i = list.findIndex(d => d.PUBLIC_PEER === origPub && d.PRIVATE_PEER === origPriv)
  const next = { PUBLIC_PEER: pub, PRIVATE_PEER: priv, ENABLED: enabled }
  if (i >= 0) list[i] = next
  else list.push(next)
  return out
}

export function addRoaming(
  hm: HybridMesh | undefined,
  pub: string,
  priv: string,
  type: 'flatten' | 'nat',
  enabled = true
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm } as any) as HybridMesh : emptyHybridMesh()
  if (!out.ROAMING) out.ROAMING = []
  if (!out.ROAMING.some(r => r.PUBLIC_PEER === pub && r.PRIVATE_PEER === priv)) {
    out.ROAMING.push({ PUBLIC_PEER: pub, PRIVATE_PEER: priv, ENABLED: enabled, TYPE: type })
  }
  return out
}

export function removeRoaming(
  hm: HybridMesh | undefined,
  pub: string,
  priv: string
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm } as any) as HybridMesh : emptyHybridMesh()
  if (out.ROAMING) {
    out.ROAMING = out.ROAMING.filter(
      r => !(r.PUBLIC_PEER === pub && r.PRIVATE_PEER === priv)
    )
  }
  return out
}

// In-place edit (see updateDeclaration): keep the roaming entry's position.
export function updateRoaming(
  hm: HybridMesh | undefined,
  origPub: string,
  origPriv: string,
  pub: string,
  priv: string,
  type: 'flatten' | 'nat',
  enabled = true
): HybridMesh {
  const out = hm ? cloneConfig({ ...hm } as any) as HybridMesh : emptyHybridMesh()
  if (!out.ROAMING) out.ROAMING = []
  const i = out.ROAMING.findIndex(r => r.PUBLIC_PEER === origPub && r.PRIVATE_PEER === origPriv)
  const next: RoamingEntry = { PUBLIC_PEER: pub, PRIVATE_PEER: priv, ENABLED: enabled, TYPE: type }
  if (i >= 0) out.ROAMING[i] = next
  else out.ROAMING.push(next)
  return out
}
