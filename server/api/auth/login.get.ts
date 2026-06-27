import * as jose from 'jose'
import { createLogger } from '~/server/utils/logger'
import { resolveRedirectUri } from '~/server/utils/redirect-uri'

const log = createLogger('Auth:OIDC')

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
