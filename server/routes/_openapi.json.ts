// Filtered OpenAPI spec: adds x-internal to Internal/App Routes tags
// so Scalar hides Nitro's non-API routes.
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
