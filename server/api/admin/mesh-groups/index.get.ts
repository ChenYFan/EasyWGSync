import { configService } from '~/server/services/config-service'

defineRouteMeta({ openAPI: {
    "summary": "获取 mesh 组列表",
    "description": "列出全部 mesh 组及其成员与启用状态。需要管理员登录。",
    "tags": [
      "admin",
      "mesh-groups"
    ]
  } })
export default defineEventHandler(async () => {
  return configService.listGroups()
})
