import { configService } from '~/server/services/config-service'
import { P2PConfigSchema } from '~/server/utils/schemas'

defineRouteMeta({ openAPI: {
    "summary": "更新点对点连接配置",
    "description": "按路径中的源与目标公钥新增或覆盖该连接的端点、AllowedIPs、keepalive。body 传连接配置字段。需要管理员登录。",
    "tags": ["admin"]
  } })
export default defineEventHandler(async (event) => {
  const source = decodeURIComponent(getRouterParam(event, 'source')!)
  const target = decodeURIComponent(getRouterParam(event, 'target')!)
  const body = await readBody(event)
  const parsed = P2PConfigSchema.parse(body)
  return configService.upsertP2P(source, target, parsed)
})
