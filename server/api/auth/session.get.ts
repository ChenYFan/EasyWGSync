import { verifyToken } from '~/server/utils/jwks'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  // Bypass when Casdoor not configured (dev mode)
  if (!config.casdoorIssuer) {
    return {
      authenticated: true,
      bypass: true,
      user: { userId: 'dev', username: 'dev', avatar: undefined },
    }
  }

  const authHeader = getRequestHeader(event, 'authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return { authenticated: false }

  try {
    const claims = await verifyToken(token, config.casdoorIssuer)
    return {
      authenticated: true,
      user: {
        userId: (claims.sub as string) || (claims.name as string) || '',
        username: (claims.preferred_username as string) || (claims.name as string) || '',
        avatar: claims.picture as string | undefined,
      },
    }
  } catch {
    return { authenticated: false }
  }
})
