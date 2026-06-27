import { configService } from '~/server/services/config-service'
import { PeerExtraConfigSchema } from '~/server/utils/schemas'

defineRouteMeta({ openAPI: {
    "summary": "更新节点配置",
    "description": "按路径中的公钥新增或覆盖该节点的覆盖配置。body 为该节点的覆盖字段。需要管理员登录。",
    "tags": [
      "admin",
      "peers"
    ]
  } })
export default defineEventHandler(async (event) => {
  const pubkey = decodeURIComponent(getRouterParam(event, 'pubkey')!)
  const body = await readBody(event)
  const parsed = PeerExtraConfigSchema.parse(body)
  return configService.upsertPeer(pubkey, parsed)
})
