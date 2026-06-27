import { configService } from '~/server/services/config-service'

export default defineEventHandler(async (event) => {
  const pubkey = decodeURIComponent(getRouterParam(event, 'pubkey')!)
  return configService.getPeer(pubkey)
})
