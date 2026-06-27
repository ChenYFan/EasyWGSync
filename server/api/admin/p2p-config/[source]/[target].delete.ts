import { configService } from '~/server/services/config-service'

export default defineEventHandler(async (event) => {
  const source = decodeURIComponent(getRouterParam(event, 'source')!)
  const target = decodeURIComponent(getRouterParam(event, 'target')!)
  await configService.deleteP2P(source, target)
  return { success: true }
})
