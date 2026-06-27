import { fetchPeerNames } from '~/server/services/wg-dashboard'
import { createLogger } from '~/server/utils/logger'

const log = createLogger('API:getAllPeerNames')

defineRouteMeta({ openAPI: {
    "summary": "获取全部节点名",
    "description": "返回所有节点的文件名列表。客户端用于查找配置。query 传 secret 鉴权。",
    "tags": [
      "client"
    ]
  } })
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const secret = query.secret as string | undefined
  const config = useRuntimeConfig()

  const realIP = getHeader(event, 'x-real-ip')
    || getHeader(event, 'x-forwarded-for')
    || getRequestIP(event)

  if (secret !== config.secret) {
    log.error(`From ${realIP} Forbidden - invalid secret`)
    throw createError({ statusCode: 403, data: { error: 'API Forbidden' } })
  }

  const peers = await fetchPeerNames()
  return { peers }
})
