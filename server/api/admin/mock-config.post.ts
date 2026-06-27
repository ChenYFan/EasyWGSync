import { generatePeerConfig } from '~/server/services/config-generator'
import { SyncConfigSchema } from '~/server/utils/schemas'

// Generate a peer's WireGuard config from an arbitrary (draft) config for mock/testing.
// Does NOT touch data/config.json. Body: { config: SyncConfig, peerName: string }
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = SyncConfigSchema.parse(body.config)
  const peerName = body.peerName as string

  if (!peerName) {
    throw createError({ statusCode: 400, data: { error: 'peerName required' } })
  }

  const result = await generatePeerConfig(peerName, parsed)
  return { config: result }
})
