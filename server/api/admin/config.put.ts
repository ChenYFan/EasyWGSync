import { configService } from '~/server/services/config-service'
import { z } from 'zod'

const UpdateSchema = z.object({
  GLOBAL_LISTEN_PORT: z.number().nullable().optional(),
  GLOBAL_DNS: z.boolean().optional(),
  GLOBAL_SCRIPTS: z.record(z.string()).optional(),
})

defineRouteMeta({ openAPI: {
    "summary": "更新全局配置",
    "description": "修改全局配置字段。仅传需要修改的字段：监听端口、DNS 开关、全局脚本。需要管理员登录。",
    "tags": [
      "admin"
    ]
  } })
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = UpdateSchema.parse(body)
  return configService.updateGlobal(parsed)
})
