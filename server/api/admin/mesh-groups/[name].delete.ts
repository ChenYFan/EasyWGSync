import { configService } from '~/server/services/config-service'

export default defineEventHandler(async (event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name')!)
  await configService.deleteGroup(name)
  return { success: true }
})
