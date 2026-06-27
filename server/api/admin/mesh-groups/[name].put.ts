import { configService } from '~/server/services/config-service'
import { MeshGroupUpdateSchema } from '~/server/utils/schemas'

export default defineEventHandler(async (event) => {
  const currentName = decodeURIComponent(getRouterParam(event, 'name')!)
  const body = await readBody(event)
  const { name, members } = MeshGroupUpdateSchema.parse(body)
  return configService.updateGroup(currentName, { name, members })
})
