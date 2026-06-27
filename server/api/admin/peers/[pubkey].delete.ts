import { configService } from '~/server/services/config-service'

defineRouteMeta({ openAPI: {
    "summary": "删除节点配置",
    "description": "按路径中的公钥删除该节点的覆盖配置，恢复为默认。需要管理员登录。",
    "tags": [
      "admin",
      "peers"
    ]
  } })
export default defineEventHandler(async (event) => {
  const pubkey = decodeURIComponent(getRouterParam(event, 'pubkey')!)
  await configService.deletePeer(pubkey)
  return { success: true }
})
