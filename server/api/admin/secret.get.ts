import { createLogger } from '~/server/utils/logger'

const log = createLogger('API:admin:secret')

// Returns the client-pull secret (the `secret` runtimeConfig used by
// /api/getPeerConfig?secret=...&peername=...). Only reachable by authenticated
// admins (server/middleware/auth.ts guards /api/admin/**), so the secret can be
// surfaced for building "open URL" links in the FullConfigModal.
defineRouteMeta({ openAPI: {
    "summary": "获取客户端拉取密钥",
    "description": "返回客户端拉取配置用的 secret，用于拼装 getPeerConfig 的下载链接。需要管理员登录。",
    "tags": [
      "admin"
    ]
  } })
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  log.debug('Returning client-pull secret to admin')
  return { secret: config.secret || '' }
})
