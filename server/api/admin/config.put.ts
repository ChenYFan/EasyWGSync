import { configService } from '~/server/services/config-service'
import { z } from 'zod'

const UpdateSchema = z.object({
  GLOBAL_LISTEN_PORT: z.number().nullable().optional(),
  GLOBAL_DNS: z.boolean().optional(),
  GLOBAL_SCRIPTS: z.record(z.string()).optional(),
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = UpdateSchema.parse(body)
  return configService.updateGlobal(parsed)
})
