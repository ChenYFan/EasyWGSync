// Pre-fetch Casdoor JWKS keys at startup so first verification is instant.
import { prewarmJwks } from '~/server/utils/jwks'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  if (config.casdoorIssuer) {
    prewarmJwks(config.casdoorIssuer)
  }
})
