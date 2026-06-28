// Filtered OpenAPI spec for Scalar. Fetches Nitro's raw spec (at /_openapi-raw)
// and adds `x-internal: true` to the Internal + App Routes tag definitions, so
// Scalar hides Nitro's non-API routes (__nuxt_error, _openapi, _scalar, the
// root page, etc.). The API surface (admin / auth / client) is unchanged.
export default defineEventHandler(async (event) => {
  const raw = await $fetch('/_openapi-raw') as any
  if (!raw) return raw
  const tags = [...(raw.tags || [])]
  const existing = new Set(tags.map((t: any) => t.name))
  for (const name of ['Internal', 'App Routes']) {
    if (existing.has(name)) {
      tags.find((t: any) => t.name === name)!['x-internal'] = true
    } else {
      tags.push({ name, 'x-internal': true })
    }
  }
  return { ...raw, tags }
})
