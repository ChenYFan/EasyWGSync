import { generatePeerConfig } from '~/server/services/config-generator'
import { SyncConfigSchema } from '~/server/utils/schemas'

// Generate a peer's WireGuard config from an arbitrary (draft) config for mock/testing.
// Does NOT touch data/config.json. Body: { config: SyncConfig, peerName: string }
defineRouteMeta({ openAPI: {
    "summary": "生成节点预览配置",
    "description": "按 body 传入的配置生成指定节点的 WireGuard 配置文本，用于预览与路由模拟，不写入磁盘。body 传 config 与 peerName。需要管理员登录。",
    "tags": [
      "admin"
    ]
  } })
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = SyncConfigSchema.parse(body.config)
  const peerName = body.peerName as string

  if (!peerName) {
    throw createError({ statusCode: 400, data: { error: 'peerName required' } })
  }

  const result = await generatePeerConfig(peerName, parsed)
  return { config: result }
})
