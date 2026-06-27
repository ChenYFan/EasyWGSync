defineRouteMeta({ openAPI: {
    "summary": "退出登录",
    "description": "退出登录端点，由前端清除本地凭证后需重新登录。鉴权为无状态 JWT，服务端不保留会话。",
    "tags": [
      "auth"
    ]
  } })
export default defineEventHandler(() => {
  // Stateless JWT auth — nothing to invalidate server-side. The frontend
  // clears its localStorage token.
  return { success: true }
})
