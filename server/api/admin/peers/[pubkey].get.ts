import { configService } from '~/server/services/config-service'

defineRouteMeta({ openAPI: {
    "summary": "获取单个节点配置",
    "description": "按路径中的公钥读取该节点的覆盖配置。pubkey 需 URL 编码。需要管理员登录。",
    "tags": ["admin"]
  } })
export default defineEventHandler(async (event) => {
  const pubkey = decodeURIComponent(getRouterParam(event, 'pubkey')!)
  return configService.getPeer(pubkey)
})
