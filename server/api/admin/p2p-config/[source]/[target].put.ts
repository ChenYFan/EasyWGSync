import { configService } from '~/server/services/config-service'
import { P2PConfigSchema } from '~/server/utils/schemas'

export default defineEventHandler(async (event) => {
  const source = decodeURIComponent(getRouterParam(event, 'source')!)
  const target = decodeURIComponent(getRouterParam(event, 'target')!)
  const body = await readBody(event)
  const parsed = P2PConfigSchema.parse(body)
  return configService.upsertP2P(source, target, parsed)
})
