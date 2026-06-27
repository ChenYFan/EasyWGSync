import { configService } from '~/server/services/config-service'

defineRouteMeta({ openAPI: {
    "summary": "获取全局配置",
    "description": "读取已保存的全局配置：监听端口、DNS 开关、全局脚本。需要管理员登录。",
    "tags": [
      "admin"
    ]
  } })
export default defineEventHandler(async () => {
  return configService.getGlobal()
})
