import { configService } from '~/server/services/config-service'

defineRouteMeta({ openAPI: {
    "summary": "删除点对点连接配置",
    "description": "按路径中的源与目标公钥删除该连接的覆盖配置，恢复为默认。需要管理员登录。",
    "tags": [
      "admin",
      "p2p-config"
    ]
  } })
export default defineEventHandler(async (event) => {
  const source = decodeURIComponent(getRouterParam(event, 'source')!)
  const target = decodeURIComponent(getRouterParam(event, 'target')!)
  await configService.deleteP2P(source, target)
  return { success: true }
})
