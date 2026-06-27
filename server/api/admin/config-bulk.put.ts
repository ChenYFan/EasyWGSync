import { configService } from '~/server/services/config-service'
import { SyncConfigSchema } from '~/server/utils/schemas'

// Overwrite the whole config.json with a committed draft.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = SyncConfigSchema.parse(body)
  return configService.replaceAll(parsed)
})
