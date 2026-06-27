import { configService } from '~/server/services/config-service'
import { MeshGroupCreateSchema } from '~/server/utils/schemas'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, members } = MeshGroupCreateSchema.parse(body)
  return configService.createGroup(name, members)
})
