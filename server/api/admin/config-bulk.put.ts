import { configService } from '~/server/services/config-service'
import { SyncConfigSchema } from '~/server/utils/schemas'

// Overwrite the whole config.json with a committed draft.
defineRouteMeta({ openAPI: {
    "summary": "整体替换配置",
    "description": "用提交的草稿整体覆盖已保存配置，body 为完整配置对象。需要管理员登录。",
    "tags": [
      "admin"
    ]
  } })
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = SyncConfigSchema.parse(body)
  return configService.replaceAll(parsed)
})
