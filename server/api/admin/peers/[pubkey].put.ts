import { configService } from '~/server/services/config-service'
import { PeerExtraConfigSchema } from '~/server/utils/schemas'

export default defineEventHandler(async (event) => {
  const pubkey = decodeURIComponent(getRouterParam(event, 'pubkey')!)
  const body = await readBody(event)
  const parsed = PeerExtraConfigSchema.parse(body)
  return configService.upsertPeer(pubkey, parsed)
})
