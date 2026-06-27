import { configService } from '~/server/services/config-service'

export default defineEventHandler(async (event) => {
  const pubkey = decodeURIComponent(getRouterParam(event, 'pubkey')!)
  await configService.deletePeer(pubkey)
  return { success: true }
})
