import { configService } from '~/server/services/config-service'

defineRouteMeta({ openAPI: {
    "summary": "删除 mesh 组",
    "description": "按组名删除该 mesh 组，成员节点不受影响。需要管理员登录。",
    "tags": [
      "admin",
      "mesh-groups"
    ]
  } })
export default defineEventHandler(async (event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name')!)
  await configService.deleteGroup(name)
  return { success: true }
})
