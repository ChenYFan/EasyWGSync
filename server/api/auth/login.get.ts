import * as jose from 'jose'
import { createLogger } from '~/server/utils/logger'
import { resolveRedirectUri } from '~/server/utils/redirect-uri'

const log = createLogger('Auth:OIDC')

defineRouteMeta({ openAPI: {
    "summary": "跳转到登录",
    "description": "重定向到 Casdoor 进行登录。配置 Casdoor 后可用。",
    "tags": [
      "auth"
    ]
  } })
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { client_id, redirect_uri, state } = getQuery(event) as Record<string, string>

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.casdoorClientId,
    redirect_uri: resolveRedirectUri(event),
    scope: 'openid profile email',
    state: crypto.randomUUID(),
  })

  const authUrl = `${config.casdoorIssuer}/login/oauth/authorize?${params.toString()}`

  log.log('Redirecting to Casdoor:', authUrl)
  return sendRedirect(event, authUrl)
})
