import { prewarmJwks } from '~/server/utils/jwks'

// Pre-fetch Casdoor's JWKS public keys at startup so the first token
// verification is instant (one fetch, then cached + 24h refresh).
export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  if (config.casdoorIssuer) {
    prewarmJwks(config.casdoorIssuer)
  }
})
