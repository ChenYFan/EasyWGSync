import { createLogger } from '~/server/utils/logger'

const log = createLogger('API:admin:secret')

// Returns the client-pull secret (the `secret` runtimeConfig used by
// /api/getPeerConfig?secret=...&peername=...). Only reachable by authenticated
// admins (server/middleware/auth.ts guards /api/admin/**), so the secret can be
// surfaced for building "open URL" links in the FullConfigModal.
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  log.debug('Returning client-pull secret to admin')
  return { secret: config.secret || '' }
})
