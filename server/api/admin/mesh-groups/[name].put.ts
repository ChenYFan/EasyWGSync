import { configService } from '~/server/services/config-service'
import { MeshGroupUpdateSchema } from '~/server/utils/schemas'

defineRouteMeta({ openAPI: {
    "summary": "更新 mesh 组",
    "description": "按路径中的组名更新该组。body 传新的 name 与 members。需要管理员登录。",
    "tags": ["admin"]
  } })
export default defineEventHandler(async (event) => {
  const currentName = decodeURIComponent(getRouterParam(event, 'name')!)
  const body = await readBody(event)
  const { name, members } = MeshGroupUpdateSchema.parse(body)
  return configService.updateGroup(currentName, { name, members })
})
