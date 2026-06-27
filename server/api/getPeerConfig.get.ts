import { generatePeerConfig } from '~/server/services/config-generator'
import { fetchPeerNames } from '~/server/services/wg-dashboard'
import { createLogger } from '~/server/utils/logger'

const log = createLogger('API:getPeerConfig')

defineRouteMeta({ openAPI: {
    "summary": "下载节点配置",
    "description": "按节点名返回该节点的 WireGuard 配置文本。query 传 secret 鉴权、peername 指定节点。",
    "tags": [
      "client"
    ]
  } })
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const secret = query.secret as string | undefined
  const peerName = query.peername as string | undefined
  const config = useRuntimeConfig()

  const realIP = getHeader(event, 'x-real-ip')
    || getHeader(event, 'x-forwarded-for')
    || getRequestIP(event)

  log.debug(`From ${realIP} request with peername=${peerName}`)

  if (secret !== config.secret) {
    log.error(`From ${realIP} Forbidden - invalid secret`)
    throw createError({ statusCode: 403, data: { error: 'API Forbidden' } })
  }

  const allPeerNames = await fetchPeerNames()
  if (!peerName || !allPeerNames.includes(peerName)) {
    throw createError({ statusCode: 404, data: { error: 'Peer Not Found' } })
  }

  const result = await generatePeerConfig(peerName)

  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return result
})
