import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '~/server/utils/logger'

const log = createLogger('API:ewctl')

// Serve the ewctl.sh client script. Public (no auth) — it's an installer/updater
// with no secrets. Clients fetch it to /tmp and either install or self-update.
defineRouteMeta({ openAPI: {
    "summary": "下载 ewctl 脚本",
    "description": "返回 ewctl 客户端脚本，供客户端安装或自更新。公开接口，无需鉴权。",
    "tags": [
      "client"
    ]
  } })
export default defineEventHandler((event) => {
  log.debug(`From ${getHeader(event, 'x-real-ip') || getRequestIP(event)} ewctl.sh download`)
  let text: string
  try {
    text = readFileSync(join(process.cwd(), 'ewctl.sh'), 'utf-8')
  } catch (e) {
    log.error('ewctl.sh not found', e)
    throw createError({ statusCode: 404, data: { error: 'ewctl.sh not found' } })
  }
  setHeader(event, 'content-type', 'text/x-shellscript; charset=utf-8')
  setHeader(event, 'content-disposition', 'attachment; filename="ewctl.sh"')
  return text
})
