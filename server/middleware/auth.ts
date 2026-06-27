import { verifyToken } from '~/server/utils/jwks'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Only protect /api/admin/** routes
  if (!path.startsWith('/api/admin')) return

  const config = useRuntimeConfig()

  // Bypass auth when Casdoor is not configured (dev mode)
  if (!config.casdoorIssuer) {
    event.context.auth = { userId: 'dev', username: 'dev' }
    return
  }

  // Expect a Bearer JWT (Casdoor id_token) in the Authorization header.
  const authHeader = getRequestHeader(event, 'authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    throw createError({ statusCode: 401, data: { error: 'Unauthorized' } })
  }

  try {
    // Local verification against cached JWKS keys (no Casdoor call here).
    // Roles were checked at login; here we only prove the token is a valid,
    // unexpired Casdoor-signed JWT.
    const claims = await verifyToken(token, config.casdoorIssuer)
    event.context.auth = {
      userId: (claims.sub as string) || (claims.name as string) || '',
      username: (claims.preferred_username as string) || (claims.name as string) || '',
    }
  } catch {
    throw createError({ statusCode: 401, data: { error: 'Invalid or expired token' } })
  }
})
