import { verifyToken } from '~/server/utils/jwks'

defineRouteMeta({ openAPI: {
    "summary": "获取当前会话",
    "description": "返回当前登录状态与用户信息。未配置 Casdoor 时默认视为已登录的 dev 用户。",
    "tags": [
      "auth"
    ]
  } })
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
