import { configService } from '~/server/services/config-service'

export default defineEventHandler(async () => {
  return configService.listGroups()
})
