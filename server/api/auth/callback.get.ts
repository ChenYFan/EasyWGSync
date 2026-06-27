import { createLogger } from '~/server/utils/logger'
import { resolveRedirectUri } from '~/server/utils/redirect-uri'
import { decodeJwt } from 'jose'

const log = createLogger('Auth:Callback')

// Casdoor role required to access EasyWGSync.
const REQUIRED_ROLE = 'easywgsync'

defineRouteMeta({ openAPI: {
    "summary": "登录回调",
    "description": "Casdoor 登录完成后的回调端点，校验角色后签发登录凭证。无需手动调用。",
    "tags": [
      "auth"
    ]
  } })
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { code } = getQuery(event) as Record<string, string>

  if (!code) {
    throw createError({ statusCode: 400, data: { error: 'Missing authorization code' } })
  }

  // Exchange code for token
  const tokenRes = await fetch(`${config.casdoorIssuer}/api/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.casdoorClientId,
      client_secret: config.casdoorClientSecret,
      code,
      redirect_uri: resolveRedirectUri(event),
    }),
  })

  const tokenData = await tokenRes.json() as Record<string, any>
  const idToken = tokenData.id_token

  if (!idToken) {
    log.error('Token exchange failed (no id_token):', tokenData)
    throw createError({ statusCode: 401, data: { error: 'Token exchange failed' } })
  }

  // Resolve role NAMES for the easywgsync check. Prefer the id_token claim
  // (zero extra Casdoor calls); fall back to userinfo only if absent.
  // Casdoor roles can be a string array (userinfo) or an object array with a
  // `name` field (id_token) — normalize both to plain names.
  const toRoleNames = (arr: any): string[] =>
    Array.isArray(arr)
      ? arr.map((r: any) => (typeof r === 'string' ? r : (r?.name || r?.displayName || ''))).filter(Boolean)
      : []

  let roles: string[] = []
  let name = ''
  try {
    const claims = decodeJwt(idToken) as Record<string, any>
    name = claims.name || claims.preferred_username || claims.sub || ''
    roles = toRoleNames(claims.roles)
  } catch { /* malformed id_token — handled below */ }

  if (roles.length === 0 && tokenData.access_token) {
    const userInfoRes = await fetch(`${config.casdoorIssuer}/api/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userInfo = await userInfoRes.json() as Record<string, any>
    roles = toRoleNames(userInfo.roles)
    name = name || userInfo.name || ''
  }

  // Require the "easywgsync" role to log in (checked once at login; the JWT's
  // 24h lifetime bounds how long a revoked role stays effective).
  if (!roles.includes(REQUIRED_ROLE)) {
    log.warn(`User ${name} denied — roles [${roles.join(', ')}] missing "${REQUIRED_ROLE}"`)
    return sendRedirect(event, `/login?error=${encodeURIComponent('无 easywgsync 权限，禁止登录')}`)
  }

  log.log(`User ${name} logged in; issuing JWT to frontend`)

  // Hand the id_token (a JWT) to the frontend via URL query — it stores it in
  // localStorage and clears the URL. No server-side session state is kept.
  return sendRedirect(event, `/callback?token=${encodeURIComponent(idToken)}`)
})
