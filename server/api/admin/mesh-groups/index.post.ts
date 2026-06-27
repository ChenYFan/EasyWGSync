import { configService } from '~/server/services/config-service'
import { MeshGroupCreateSchema } from '~/server/utils/schemas'

defineRouteMeta({ openAPI: {
    "summary": "创建 mesh 组",
    "description": "新建一个 mesh 组并指定初始成员。body 传 name 与 members 公钥数组。需要管理员登录。",
    "tags": [
      "admin",
      "mesh-groups"
    ]
  } })
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, members } = MeshGroupCreateSchema.parse(body)
  return configService.createGroup(name, members)
})
