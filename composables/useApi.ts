export function useApi() {
  return {
    admin: {
      getGraph: () => $fetch('/api/admin/graph', { credentials: 'include' }),
      getConfig: () => $fetch('/api/admin/config', { credentials: 'include' }),
      updateConfig: (data: any) => $fetch('/api/admin/config', {
        method: 'PUT', body: data, credentials: 'include',
      }),
      getPeers: () => $fetch('/api/admin/peers', { credentials: 'include' }),
      updatePeer: (pubkey: string, data: any) => $fetch(
        `/api/admin/peers/${encodeURIComponent(pubkey)}`,
        { method: 'PUT', body: data, credentials: 'include' }
      ),
      deletePeer: (pubkey: string) => $fetch(
        `/api/admin/peers/${encodeURIComponent(pubkey)}`,
        { method: 'DELETE', credentials: 'include' }
      ),
      getMeshGroups: () => $fetch('/api/admin/mesh-groups', { credentials: 'include' }),
      createMeshGroup: (data: { name: string; members: string[] }) => $fetch(
        '/api/admin/mesh-groups',
        { method: 'POST', body: data, credentials: 'include' }
      ),
      updateMeshGroup: (name: string, data: any) => $fetch(
        `/api/admin/mesh-groups/${encodeURIComponent(name)}`,
        { method: 'PUT', body: data, credentials: 'include' }
      ),
      deleteMeshGroup: (name: string) => $fetch(
        `/api/admin/mesh-groups/${encodeURIComponent(name)}`,
        { method: 'DELETE', credentials: 'include' }
      ),
      updateP2PConfig: (source: string, target: string, data: any) => $fetch(
        `/api/admin/p2p-config/${encodeURIComponent(source)}/${encodeURIComponent(target)}`,
        { method: 'PUT', body: data, credentials: 'include' }
      ),
      deleteP2PConfig: (source: string, target: string) => $fetch(
        `/api/admin/p2p-config/${encodeURIComponent(source)}/${encodeURIComponent(target)}`,
        { method: 'DELETE', credentials: 'include' }
      ),
    },
  }
}
